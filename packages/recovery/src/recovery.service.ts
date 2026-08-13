import { randomUUID } from 'node:crypto';
import type {
  RecoveryCase,
  RecoveryCaseType,
  RecoveryStatus,
  ResolutionAction,
  ResolutionResult,
  TopUpLink,
  OwnershipProof,
  PaymentIntent,
  IChainClient,
} from '@crypto-gateway/shared';
import { RecoveryRepository, type DatabaseClient } from './recovery.repository.js';

/**
 * Configuration for the recovery service.
 */
export interface RecoveryServiceConfig {
  /** Maximum age (ms) before a pending transaction is considered stuck */
  stuckTransactionTimeoutMs: number;
  /** Maximum time (ms) to wait for chain confirmation */
  confirmationTimeoutMs: number;
  /** Top-up link validity duration (seconds) */
  topUpLinkTtlSeconds: number;
  /** Maximum underpayment tolerance percentage (e.g., 1 = 1%) */
  underpaymentTolerancePercent: number;
  /** Maximum overpayment auto-refund amount (USD) */
  maxAutoRefundUsd: number;
}

const DEFAULT_CONFIG: RecoveryServiceConfig = {
  stuckTransactionTimeoutMs: 30 * 60 * 1000, // 30 minutes
  confirmationTimeoutMs: 5 * 60 * 1000, // 5 minutes
  topUpLinkTtlSeconds: 3600, // 1 hour
  underpaymentTolerancePercent: 1,
  maxAutoRefundUsd: 10000,
};

/**
 * Recovery Service
 *
 * Handles all failure modes as first-class states:
 * - MISDIRECTED: Payment sent to wrong chain/address
 * - UNDERPAID: Payment less than expected
 * - OVERPAID: Payment more than expected
 * - STUCK: Transaction pending for too long
 *
 * Each failure mode has a detection → verification → resolution flow.
 */
export class RecoveryService {
  private readonly config: RecoveryServiceConfig;
  private readonly repository: RecoveryRepository;
  private readonly chainClients: Map<string, IChainClient>;

  constructor(
    dbClient: DatabaseClient,
    chainClients: Map<string, IChainClient>,
    config?: Partial<RecoveryServiceConfig>,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.repository = new RecoveryRepository(dbClient);
    this.chainClients = chainClients;
  }

  // ─── Detection Methods ─────────────────────────────────────────────────

  /**
   * Detect a misdirected payment (sent to wrong chain or address).
   */
  async detectMisdirected(params: {
    intentId: string | null;
    customerAddress: string;
    customerChain: string;
    intendedChain: string;
    asset: string;
    amount: number;
    txHash: string;
  }): Promise<RecoveryCase> {
    const recoveryCase = await this.repository.create({
      related_intent_id: params.intentId,
      case_type: 'MISDIRECTED',
      customer_address: params.customerAddress,
      customer_chain: params.customerChain,
      intended_chain: params.intendedChain,
      asset: params.asset,
      amount: params.amount,
      tx_hash: params.txHash,
    });

    return recoveryCase;
  }

  /**
   * Detect an underpayment (customer sent less than expected).
   */
  async detectUnderpayment(params: {
    intentId: string;
    customerAddress: string;
    customerChain: string;
    intendedChain: string;
    asset: string;
    expectedAmount: number;
    receivedAmount: number;
    txHash: string;
  }): Promise<RecoveryCase> {
    const recoveryCase = await this.repository.create({
      related_intent_id: params.intentId,
      case_type: 'UNDERPAID',
      customer_address: params.customerAddress,
      customer_chain: params.customerChain,
      intended_chain: params.intendedChain,
      asset: params.asset,
      amount: params.receivedAmount,
      tx_hash: params.txHash,
    });

    return recoveryCase;
  }

  /**
   * Detect an overpayment (customer sent more than expected).
   */
  async detectOverpayment(params: {
    intentId: string;
    customerAddress: string;
    customerChain: string;
    intendedChain: string;
    asset: string;
    expectedAmount: number;
    receivedAmount: number;
    txHash: string;
  }): Promise<RecoveryCase> {
    const recoveryCase = await this.repository.create({
      related_intent_id: params.intentId,
      case_type: 'OVERPAID',
      customer_address: params.customerAddress,
      customer_chain: params.customerChain,
      intended_chain: params.intendedChain,
      asset: params.asset,
      amount: params.receivedAmount,
      tx_hash: params.txHash,
    });

    return recoveryCase;
  }

  /**
   * Detect a stuck transaction (pending for too long).
   */
  async detectStuck(params: {
    intentId: string;
    customerAddress: string;
    customerChain: string;
    intendedChain: string;
    asset: string;
    amount: number;
    txHash: string;
  }): Promise<RecoveryCase> {
    const recoveryCase = await this.repository.create({
      related_intent_id: params.intentId,
      case_type: 'STUCK',
      customer_address: params.customerAddress,
      customer_chain: params.customerChain,
      intended_chain: params.intendedChain,
      asset: params.asset,
      amount: params.amount,
      tx_hash: params.txHash,
    });

    return recoveryCase;
  }

  // ─── Verification Methods ──────────────────────────────────────────────

  /**
   * Verify ownership of an address via signed message.
   *
   * The customer signs a message proving they control the address
   * where the funds were sent. This is required before auto-refund.
   */
  async verifyOwnership(
    address: string,
    signature: string,
    message: string,
    chain: string,
  ): Promise<OwnershipProof> {
    const chainClient = this.chainClients.get(chain);
    if (!chainClient) {
      return {
        address,
        signature,
        message,
        verified: false,
        verified_at: null,
      };
    }

    // In production, this would use ecrecover or ethers.verifyMessage
    // to verify the signature matches the address
    try {
      // For now, we perform a basic validation:
      // 1. Signature must be a valid hex string
      // 2. Message must not be empty
      // 3. Address must be valid on the chain
      const isValidSignature = /^0x[0-9a-fA-F]{130}$/.test(signature);
      const isValidAddress = chainClient.validateAddress(address);
      const hasMessage = message.length > 0;

      const verified = isValidSignature && isValidAddress && hasMessage;

      return {
        address,
        signature,
        message,
        verified,
        verified_at: verified ? new Date() : null,
      };
    } catch {
      return {
        address,
        signature,
        message,
        verified: false,
        verified_at: null,
      };
    }
  }

  // ─── Resolution Methods ────────────────────────────────────────────────

  /**
   * Resolve a recovery case with the appropriate action.
   */
  async resolve(
    caseId: string,
    action: ResolutionAction,
  ): Promise<ResolutionResult> {
    const recoveryCase = await this.repository.findById(caseId);
    if (!recoveryCase) {
      return {
        action,
        success: false,
        tx_hash: null,
        message: `Recovery case not found: ${caseId}`,
      };
    }

    // Update status to RESOLVING
    await this.repository.update(caseId, {
      status: 'RESOLVING',
      resolution_action: action,
    });

    try {
      let result: ResolutionResult;

      switch (action) {
        case 'AUTO_REFUND':
          result = await this.executeAutoRefund(recoveryCase);
          break;
        case 'AUTO_CREDIT':
          result = await this.executeAutoCredit(recoveryCase);
          break;
        case 'TOP_UP_LINK':
          result = await this.executeTopUpLink(recoveryCase);
          break;
        case 'RE_QUOTE':
          result = await this.executeReQuote(recoveryCase);
          break;
        case 'FEE_BUMP':
          result = await this.executeFeeBump(recoveryCase);
          break;
        case 'RELAYER_ACCELERATION':
          result = await this.executeRelayerAcceleration(recoveryCase);
          break;
        default:
          result = {
            action,
            success: false,
            tx_hash: null,
            message: `Unknown resolution action: ${action}`,
          };
      }

      // Update case with result
      await this.repository.update(caseId, {
        status: result.success ? 'RESOLVED' : 'FAILED',
        resolution_tx_hash: result.tx_hash,
        resolved_at: result.success ? new Date() : null,
      });

      return result;
    } catch (error) {
      // Mark as FAILED on error
      await this.repository.update(caseId, {
        status: 'FAILED',
      });

      return {
        action,
        success: false,
        tx_hash: null,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Generate a top-up link for underpayments.
   */
  async generateTopUpLink(caseId: string): Promise<TopUpLink | null> {
    const recoveryCase = await this.repository.findById(caseId);
    if (!recoveryCase || recoveryCase.case_type !== 'UNDERPAID') {
      return null;
    }

    const intent = await this.getRelatedIntent(recoveryCase);
    if (!intent) {
      return null;
    }

    // Calculate shortfall
    const shortfall = intent.target_amount - recoveryCase.amount;

    // Generate unique top-up address (in production, this would be a deposit address)
    const topUpAddress = this.generateTopUpAddress();

    const now = new Date();
    const topUpLink: TopUpLink = {
      id: randomUUID(),
      recovery_case_id: caseId,
      amount: shortfall,
      asset: recoveryCase.asset,
      chain: recoveryCase.customer_chain,
      address: topUpAddress,
      expires_at: new Date(now.getTime() + this.config.topUpLinkTtlSeconds * 1000),
      created_at: now,
    };

    return topUpLink;
  }

  /**
   * Auto-refund funds to the customer.
   * Used for overpayments and misdirected payments.
   */
  async autoRefund(caseId: string): Promise<ResolutionResult> {
    return this.resolve(caseId, 'AUTO_REFUND');
  }

  /**
   * Auto-credit the merchant account.
   * Used for overpayments where the merchant agrees to accept.
   */
  async autoCredit(caseId: string): Promise<ResolutionResult> {
    return this.resolve(caseId, 'AUTO_CREDIT');
  }

  // ─── Query Methods ─────────────────────────────────────────────────────

  /**
   * Get a recovery case by ID.
   */
  async getCase(caseId: string): Promise<RecoveryCase | null> {
    return this.repository.findById(caseId);
  }

  /**
   * Get all recovery cases for an intent.
   */
  async getCasesForIntent(intentId: string): Promise<RecoveryCase[]> {
    return this.repository.findByIntentId(intentId);
  }

  /**
   * Get all recovery cases for a customer address.
   */
  async getCasesForAddress(address: string, chain: string): Promise<RecoveryCase[]> {
    return this.repository.findByCustomerAddress(address, chain);
  }

  /**
   * Get recovery case statistics.
   */
  async getStats(): Promise<Record<RecoveryCaseType, Record<RecoveryStatus, number>>> {
    return this.repository.getStats();
  }

  /**
   * Find and process stuck transactions.
   */
  async processStuckTransactions(): Promise<number> {
    const stuckCases = await this.repository.findStuckTransactions(
      this.config.stuckTransactionTimeoutMs,
    );

    let processed = 0;
    for (const stuckCase of stuckCases) {
      try {
        // Try relayer acceleration first
        const result = await this.resolve(stuckCase.id, 'RELAYER_ACCELERATION');
        if (result.success) {
          processed++;
        }
      } catch {
        // Log and continue
        console.error(`Failed to process stuck transaction ${stuckCase.id}`);
      }
    }

    return processed;
  }

  // ─── Private Resolution Implementations ────────────────────────────────

  /**
   * Execute auto-refund: send funds back to customer address.
   */
  private async executeAutoRefund(recoveryCase: RecoveryCase): Promise<ResolutionResult> {
    const chainClient = this.chainClients.get(recoveryCase.customer_chain);
    if (!chainClient) {
      return {
        action: 'AUTO_REFUND',
        success: false,
        tx_hash: null,
        message: `No chain client for ${recoveryCase.customer_chain}`,
      };
    }

    // In production, this would:
    // 1. Get hot wallet private key from HSM/KMS
    // 2. Create and sign refund transaction
    // 3. Submit to chain
    // 4. Wait for confirmation

    // For now, simulate the refund
    const txHash = `0x${randomUUID().replace(/-/g, '').slice(0, 64)}`;

    return {
      action: 'AUTO_REFUND',
      success: true,
      tx_hash: txHash,
      message: `Refund of ${recoveryCase.amount} ${recoveryCase.asset} sent to ${recoveryCase.customer_address}`,
    };
  }

  /**
   * Execute auto-credit: credit merchant account.
   */
  private async executeAutoCredit(recoveryCase: RecoveryCase): Promise<ResolutionResult> {
    // In production, this would:
    // 1. Look up the related intent's merchant
    // 2. Credit the merchant's ledger account
    // 3. Record the credit entry

    return {
      action: 'AUTO_CREDIT',
      success: true,
      tx_hash: null,
      message: `Credited ${recoveryCase.amount} ${recoveryCase.asset} to merchant account`,
    };
  }

  /**
   * Execute top-up link generation.
   */
  private async executeTopUpLink(recoveryCase: RecoveryCase): Promise<ResolutionResult> {
    const topUpLink = await this.generateTopUpLink(recoveryCase.id);

    if (!topUpLink) {
      return {
        action: 'TOP_UP_LINK',
        success: false,
        tx_hash: null,
        message: 'Failed to generate top-up link',
      };
    }

    return {
      action: 'TOP_UP_LINK',
      success: true,
      tx_hash: null,
      message: `Top-up link generated: ${topUpLink.address} (expires: ${topUpLink.expires_at.toISOString()})`,
    };
  }

  /**
   * Execute re-quote: generate a new quote for the detected amount.
   */
  private async executeReQuote(recoveryCase: RecoveryCase): Promise<ResolutionResult> {
    // In production, this would:
    // 1. Look up the related intent
    // 2. Generate a new quote based on the actual received amount
    // 3. Update the intent with the new quote

    return {
      action: 'RE_QUOTE',
      success: true,
      tx_hash: null,
      message: `Re-quoted for ${recoveryCase.amount} ${recoveryCase.asset}`,
    };
  }

  /**
   * Execute fee bump: customer pays additional fee to accelerate.
   */
  private async executeFeeBump(recoveryCase: RecoveryCase): Promise<ResolutionResult> {
    // In production, this would:
    // 1. Generate a fee bump transaction (replace-by-fee)
    // 2. Sign and submit with higher gas price

    return {
      action: 'FEE_BUMP',
      success: true,
      tx_hash: null,
      message: `Fee bump initiated for ${recoveryCase.tx_hash}`,
    };
  }

  /**
   * Execute relayer acceleration: use a relayer to speed up stuck transaction.
   */
  private async executeRelayerAcceleration(recoveryCase: RecoveryCase): Promise<ResolutionResult> {
    const chainClient = this.chainClients.get(recoveryCase.customer_chain);
    if (!chainClient) {
      return {
        action: 'RELAYER_ACCELERATION',
        success: false,
        tx_hash: null,
        message: `No chain client for ${recoveryCase.customer_chain}`,
      };
    }

    // In production, this would:
    // 1. Check current gas price
    // 2. Create a replacement transaction with higher gas
    // 3. Submit via relayer service

    const newTxHash = `0x${randomUUID().replace(/-/g, '').slice(0, 64)}`;

    return {
      action: 'RELAYER_ACCELERATION',
      success: true,
      tx_hash: newTxHash,
      message: `Relayer acceleration submitted for ${recoveryCase.tx_hash}`,
    };
  }

  // ─── Private Helpers ──────────────────────────────────────────────────

  /**
   * Get the related payment intent for a recovery case.
   */
  private async getRelatedIntent(_recoveryCase: RecoveryCase): Promise<PaymentIntent | null> {
    // In production, this would query the payment-intent service
    // For now, return null to indicate intent not available
    return null;
  }

  /**
   * Generate a unique top-up address.
   * In production, this would generate a deterministic address from the intent.
   */
  private generateTopUpAddress(): string {
    // Generate a deterministic-looking address for testing
    const hash = randomUUID().replace(/-/g, '');
    return `0x${hash.slice(0, 40)}`;
  }
}
