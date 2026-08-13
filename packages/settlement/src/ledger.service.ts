/**
 * Ledger Service
 *
 * Double-entry accounting engine. Every financial movement is recorded
 * as a pair of debit/credit entries. The ledger is append-only —
 * entries are never updated or deleted, only created.
 *
 * Account naming convention:
 *   - customer:{id}     — customer balance
 *   - merchant:{id}     — merchant receivable
 *   - pending:{id}      — escrow for in-flight intent
 *   - revenue:fees      — fee income
 *   - revenue:fx        — FX gain
 *   - expense:fx        — FX loss
 *   - treasury:{chain}  — hot wallet balance
 */

import type {
  LedgerEntry,
  Settlement,
} from '@crypto-gateway/shared';
import { LedgerRepository } from './ledger.repository.js';

export interface DepositRecord {
  intent_id: string;
  amount: number;
  asset: string;
  chain: string;
  customer_id: string;
  tx_hash: string;
  source_address: string;
}

export interface FeeRecord {
  intent_id: string;
  amount: number;
  asset: string;
  chain: string;
  merchant_id: string;
  fee_type: string;
  percentage: number;
}

export interface RefundRecord {
  intent_id: string;
  amount: number;
  asset: string;
  chain: string;
  merchant_id: string;
  customer_id: string;
  tx_hash: string;
  reason: string;
}

export interface LedgerStatement {
  account_id: string;
  start_date: Date;
  end_date: Date;
  entries: LedgerEntry[];
  total_debits: number;
  total_credits: number;
  closing_balance: number;
}

export class LedgerService {
  constructor(private ledgerRepo: LedgerRepository) {}

  /**
   * Record a customer deposit.
   * DR: pending:{intent} (escrow increases)
   * CR: customer:{id}   (customer balance decreases)
   */
  async recordDeposit(deposit: DepositRecord): Promise<LedgerEntry> {
    return this.ledgerRepo.create({
      intent_id: deposit.intent_id,
      entry_type: 'DEPOSIT',
      amount: deposit.amount,
      asset: deposit.asset,
      chain: deposit.chain,
      debit_account: `pending:${deposit.intent_id}`,
      credit_account: `customer:${deposit.customer_id}`,
      metadata: {
        tx_hash: deposit.tx_hash,
        source_address: deposit.source_address,
      },
    });
  }

  /**
   * Record a platform fee.
   * DR: merchant:{id}    (merchant receivable decreases)
   * CR: revenue:fees     (fee income increases)
   */
  async recordFee(fee: FeeRecord): Promise<LedgerEntry> {
    return this.ledgerRepo.create({
      intent_id: fee.intent_id,
      entry_type: 'FEE',
      amount: fee.amount,
      asset: fee.asset,
      chain: fee.chain,
      debit_account: `merchant:${fee.merchant_id}`,
      credit_account: 'revenue:fees',
      metadata: {
        fee_type: fee.fee_type,
        percentage: fee.percentage,
      },
    });
  }

  /**
   * Record a settlement payout to merchant.
   * DR: pending:{intent}  (escrow decreases)
   * CR: merchant:{id}     (merchant balance increases)
   */
  async recordSettlement(settlement: Settlement): Promise<LedgerEntry> {
    return this.ledgerRepo.create({
      intent_id: settlement.intent_id,
      entry_type: 'SETTLEMENT',
      amount: settlement.amount,
      asset: settlement.asset,
      chain: settlement.chain,
      debit_account: `pending:${settlement.intent_id}`,
      credit_account: `merchant:${settlement.merchant_id}`,
      metadata: {
        tx_hash: settlement.tx_hash,
        destination_address: settlement.destination_address,
      },
    });
  }

  /**
   * Record a refund to customer.
   * DR: merchant:{id}     (merchant balance decreases)
   * CR: customer:{id}     (customer balance increases)
   */
  async recordRefund(refund: RefundRecord): Promise<LedgerEntry> {
    return this.ledgerRepo.create({
      intent_id: refund.intent_id,
      entry_type: 'REFUND',
      amount: refund.amount,
      asset: refund.asset,
      chain: refund.chain,
      debit_account: `merchant:${refund.merchant_id}`,
      credit_account: `customer:${refund.customer_id}`,
      metadata: {
        tx_hash: refund.tx_hash,
        reason: refund.reason,
      },
    });
  }

  /**
   * Record FX gain or loss.
   * Gain:  DR: revenue:fx  CR: expense:fx
   * Loss:  DR: expense:fx  CR: revenue:fx
   */
  async recordFxGainLoss(
    intentId: string,
    asset: string,
    chain: string,
    gain: number,
  ): Promise<LedgerEntry> {
    const isGain = gain >= 0;

    return this.ledgerRepo.create({
      intent_id: intentId,
      entry_type: 'FX_GAIN_LOSS',
      amount: Math.abs(gain),
      asset,
      chain,
      debit_account: isGain ? 'revenue:fx' : 'expense:fx',
      credit_account: isGain ? 'expense:fx' : 'revenue:fx',
      metadata: { type: isGain ? 'gain' : 'loss' },
    });
  }

  /**
   * Get balance for any account and asset.
   */
  async getBalance(accountId: string, asset: string): Promise<number> {
    return this.ledgerRepo.getBalance(accountId, asset);
  }

  /**
   * Get merchant balance for a specific asset.
   */
  async getMerchantBalance(merchantId: string, asset: string): Promise<number> {
    return this.ledgerRepo.getMerchantBalance(merchantId, asset);
  }

  /**
   * Generate a ledger statement for an account in a period.
   */
  async getStatement(
    accountId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<LedgerStatement> {
    const entries = await this.ledgerRepo.findByAccount(accountId, startDate, endDate);

    let totalDebits = 0;
    let totalCredits = 0;

    for (const entry of entries) {
      if (entry.debit_account === accountId) {
        totalDebits += entry.amount;
      }
      if (entry.credit_account === accountId) {
        totalCredits += entry.amount;
      }
    }

    return {
      account_id: accountId,
      start_date: startDate,
      end_date: endDate,
      entries,
      total_debits: totalDebits,
      total_credits: totalCredits,
      closing_balance: totalDebits - totalCredits,
    };
  }

  /**
   * Get all ledger entries for an intent.
   */
  async getEntriesByIntent(intentId: string): Promise<LedgerEntry[]> {
    return this.ledgerRepo.findByIntentId(intentId);
  }

  /**
   * Verify ledger consistency (double-entry invariant).
   */
  async verifyConsistency(): Promise<{
    isConsistent: boolean;
    totalDebits: number;
    totalCredits: number;
    difference: number;
  }> {
    return this.ledgerRepo.verifyConsistency();
  }

  /**
   * Calculate the settlement amount after fees.
   */
  calculateSettlementAmount(targetAmount: number, feePercentage: number): number {
    const fee = targetAmount * (feePercentage / 100);
    return Math.round((targetAmount - fee) * 1e8) / 1e8; // 8 decimal precision
  }
}
