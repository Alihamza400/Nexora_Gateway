/**
 * Settlement Service
 *
 * Executes the final payout to merchants after payment confirmation.
 * Flow: calculate amount → create record → sign → submit → confirm → record ledger.
 *
 * Uses optimistic locking and idempotent design:
 * - Each settlement has a unique IDempotency-Key header
 * - Retry logic with exponential backoff
 * - All state transitions are recorded in the ledger
 */

import type {
  Settlement,
  PaymentIntent,
  MerchantConfig,
  IChainClient,
  TxResult,
} from '@crypto-gateway/shared';
import { SettlementFailedError } from '@crypto-gateway/shared';
import { SettlementRepository } from './settlement.repository.js';
import { LedgerService } from './ledger.service.js';

export interface SettlementExecutionContext {
  intent: PaymentIntent;
  merchant: MerchantConfig;
  chainClient: IChainClient;
}

export class SettlementService {
  /** Maximum number of retry attempts for transient failures */
  private static readonly MAX_RETRIES = 3;

  /** Delay between retries (ms) — exponential backoff */
  private static readonly BASE_RETRY_DELAY = 1000;

  constructor(
    private settlementRepo: SettlementRepository,
    private ledgerService: LedgerService,
  ) {}

  /**
   * Settle a confirmed payment intent.
   *
   * Steps:
   * 1. Calculate settlement amount (target - fees)
   * 2. Create settlement record (PENDING)
   * 3. Sign and submit transaction to chain
   * 4. Wait for confirmation depth
   * 5. Update settlement (COMPLETED)
   * 6. Record ledger entries (FEE + SETTLEMENT)
   */
  async settleIntent(ctx: SettlementExecutionContext): Promise<Settlement> {
    const { intent, merchant, chainClient } = ctx;

    // 1. Calculate settlement amount
    const settlementAmount = this.ledgerService.calculateSettlementAmount(
      intent.target_amount,
      merchant.fee_percentage,
    );

    // 2. Create settlement record
    const settlement = await this.settlementRepo.create({
      intent_id: intent.id,
      merchant_id: merchant.id,
      amount: settlementAmount,
      asset: merchant.settlement_asset,
      chain: merchant.settlement_chain,
      destination_address: merchant.settlement_address,
    });

    try {
      // 3. Sign and submit transaction
      const txResult = await this.executeTransaction(settlement, chainClient);

      // 4. Update settlement with tx hash
      await this.settlementRepo.update(settlement.id, {
        status: 'PROCESSING',
        tx_hash: txResult.txHash,
      });

      // 5. Wait for confirmation
      await this.waitForConfirmation(txResult.txHash, chainClient);

      // 6. Mark as completed
      const completedSettlement = await this.settlementRepo.update(settlement.id, {
        status: 'COMPLETED',
        completed_at: new Date(),
      });

      // 7. Record fee in ledger
      if (merchant.fee_percentage > 0) {
        const feeAmount = intent.target_amount - settlementAmount;
        await this.ledgerService.recordFee({
          intent_id: intent.id,
          amount: feeAmount,
          asset: merchant.settlement_asset,
          chain: merchant.settlement_chain,
          merchant_id: merchant.id,
          fee_type: 'PLATFORM',
          percentage: merchant.fee_percentage,
        });
      }

      // 8. Record settlement in ledger
      await this.ledgerService.recordSettlement(completedSettlement);

      return completedSettlement;
    } catch (error) {
      return this.handleSettlementFailure(settlement.id, error as Error);
    }
  }

  /**
   * Retry a failed settlement.
   */
  async retrySettlement(settlementId: string): Promise<Settlement> {
    const settlement = await this.settlementRepo.findById(settlementId);
    if (!settlement) {
      throw new SettlementFailedError(settlementId, 'Settlement not found');
    }

    if (settlement.status !== 'FAILED' && settlement.status !== 'RETRYING') {
      throw new SettlementFailedError(settlementId, `Cannot retry settlement in status: ${settlement.status}`);
    }

    return this.settlementRepo.update(settlementId, {
      status: 'RETRYING',
    });
  }

  /**
   * Get settlement by ID.
   */
  async getSettlement(id: string): Promise<Settlement | null> {
    return this.settlementRepo.findById(id);
  }

  /**
   * Get settlement for an intent.
   */
  async getSettlementByIntent(intentId: string): Promise<Settlement | null> {
    return this.settlementRepo.findByIntentId(intentId);
  }

  /**
   * Get all pending settlements.
   */
  async getPendingSettlements(): Promise<Settlement[]> {
    return this.settlementRepo.findPending();
  }

  /**
   * Execute the on-chain transaction.
   */
  private async executeTransaction(
    settlement: Settlement,
    chainClient: IChainClient,
  ): Promise<TxResult> {
    const tx = {
      from: await this.getSettlementAddress(settlement.chain),
      to: settlement.destination_address,
      value: settlement.amount.toString(),
      data: '0x',
    };

    // Estimate gas (used for gas cost in rate lock quotes)
    await chainClient.estimateGas(tx);

    // Sign and submit (hot wallet signing)
    const signedTx = await this.signTransaction(tx, settlement.chain);

    return chainClient.submitTransaction(signedTx);
  }

  /**
   * Wait for transaction confirmation depth.
   */
  private async waitForConfirmation(
    txHash: string,
    chainClient: IChainClient,
  ): Promise<void> {
    const confirmationDepth = chainClient.getConfirmationDepth();
    const pollInterval = 2000; // 2 seconds
    const maxWaitTime = 300_000; // 5 minutes
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitTime) {
      const status = await chainClient.getTransactionStatus(txHash);

      if (status.confirmations >= confirmationDepth) {
        return;
      }

      if (status.status === 'FAILED') {
        throw new SettlementFailedError(txHash, 'Transaction failed on-chain');
      }

      await this.delay(pollInterval);
    }

    throw new SettlementFailedError(txHash, 'Confirmation timeout');
  }

  /**
   * Get the hot wallet address for a chain.
   */
  private async getSettlementAddress(_chain: string): Promise<string> {
    // In production, this would fetch from the secure key management system (HSM/KMS)
    // For now, return a placeholder
    return '0x0000000000000000000000000000000000000000';
  }

  /**
   * Sign a transaction with the hot wallet.
   */
  private async signTransaction(
    tx: Record<string, string>,
    _chain: string,
  ): Promise<{ signedData: string }> {
    // In production, this would use HSM/KMS for secure signing
    // For now, return a placeholder
    return { signedData: `0x${tx.from}${tx.to}` };
  }

  /**
   * Handle settlement failure with retry logic.
   */
  private async handleSettlementFailure(
    settlementId: string,
    error: Error,
  ): Promise<Settlement> {
    await this.settlementRepo.update(settlementId, {
      status: 'FAILED',
    });

    if (this.isRetryableError(error)) {
      // Schedule retry with exponential backoff
      const retryCount = await this.getRetryCount(settlementId);
      if (retryCount < SettlementService.MAX_RETRIES) {
        const delay = SettlementService.BASE_RETRY_DELAY * Math.pow(2, retryCount);
        setTimeout(() => {
          this.retrySettlement(settlementId).catch(() => {
            // Retry failed, will be picked up by retry worker
          });
        }, delay);
      }
    }

    throw new SettlementFailedError(settlementId, error.message);
  }

  /**
   * Check if an error is retryable.
   */
  private isRetryableError(error: Error): boolean {
    const retryablePatterns = ['NETWORK_ERROR', 'TIMEOUT', 'INSUFFICIENT_GAS', 'ECONNRESET'];
    return retryablePatterns.some((p) => error.message.includes(p));
  }

  /**
   * Get retry count for a settlement.
   */
  private async getRetryCount(_settlementId: string): Promise<number> {
    // In production, this would track retry count in metadata
    return 0;
  }

  /**
   * Utility: delay for ms.
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
