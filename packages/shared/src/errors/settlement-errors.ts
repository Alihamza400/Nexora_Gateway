/**
 * Settlement-specific error classes.
 */

import { GatewayError } from './index.js';

export class SettlementNotFoundError extends GatewayError {
  constructor(settlementId: string) {
    super('SETTLEMENT_NOT_FOUND', `Settlement not found: ${settlementId}`, 404);
  }
}

export class SettlementAlreadyCompletedError extends GatewayError {
  constructor(settlementId: string) {
    super('SETTLEMENT_ALREADY_COMPLETED', `Settlement already completed: ${settlementId}`, 409);
  }
}

export class LedgerInconsistencyError extends GatewayError {
  constructor(details: { totalDebits: number; totalCredits: number; difference: number }) {
    super(
      'LEDGER_INCONSISTENCY',
      `Ledger inconsistency detected: debits=${details.totalDebits}, credits=${details.totalCredits}, diff=${details.difference}`,
      500,
      details,
    );
  }
}

export class SettlementAmountMismatchError extends GatewayError {
  constructor(expected: number, actual: number) {
    super(
      'SETTLEMENT_AMOUNT_MISMATCH',
      `Settlement amount mismatch: expected ${expected}, got ${actual}`,
      400,
      { expected, actual },
    );
  }
}

export class HotWalletInsufficientBalanceError extends GatewayError {
  constructor(chain: string, required: string, available: string) {
    super(
      'HOT_WALLET_INSUFFICIENT_BALANCE',
      `Hot wallet on ${chain} has insufficient balance`,
      500,
      { chain, required, available },
    );
  }
}
