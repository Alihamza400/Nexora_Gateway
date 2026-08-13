import { describe, it, expect } from 'vitest';
import {
  GatewayError,
  IntentNotFoundError,
  InvalidTransitionError,
  QuoteExpiredError,
  MerchantNotFoundError,
  ValidationError,
  UnsupportedChainError,
  TransactionFailedError,
  NoValidQuotesError,
  ProviderUnavailableError,
  SettlementFailedError,
  InsufficientBalanceError,
  SanctionedAddressError,
  ComplianceCheckFailedError,
} from './index.js';
import {
  InvalidAddressError,
  InsufficientGasError,
  RpcError,
  ReorgDetectedError,
  TransactionRevertedError,
  BalanceQueryError,
  DepositWatcherError,
} from './chain-errors.js';
import {
  RouteNotFoundError,
  RouteExpiredError,
  RouteExecutionTimeoutError,
  SlippageExceededError,
  InsufficientLiquidityError,
} from './routing-errors.js';
import {
  SettlementNotFoundError,
  SettlementAlreadyCompletedError,
  LedgerInconsistencyError,
  SettlementAmountMismatchError,
  HotWalletInsufficientBalanceError,
} from './settlement-errors.js';
import {
  PriceOracleError,
  PriceStaleError,
  PriceConfidenceError,
  RateLockExpiredError,
  RateLockNotFoundError,
  RateLockAlreadyConsumedError,
  SpreadExceededError,
  RiskScoringError,
  SanctionsCheckError,
  AddressBlockedError,
  ComplianceGateError,
  TreasuryInsufficientError,
  TreasuryReplenishmentError,
} from './rate-lock-errors.js';

describe('Error Classes', () => {
  // ─── GatewayError (Base) ─────────────────────────────────────────────

  describe('GatewayError', () => {
    it('has correct properties', () => {
      const error = new GatewayError('TEST_ERROR', 'Test message', 400, { key: 'value' });
      expect(error.code).toBe('TEST_ERROR');
      expect(error.message).toBe('Test message');
      expect(error.statusCode).toBe(400);
      expect(error.details).toEqual({ key: 'value' });
      expect(error.name).toBe('GatewayError');
    });

    it('defaults to status 500', () => {
      const error = new GatewayError('TEST', 'msg');
      expect(error.statusCode).toBe(500);
    });

    it('is an instance of Error', () => {
      const error = new GatewayError('TEST', 'msg');
      expect(error).toBeInstanceOf(Error);
    });
  });

  // ─── Payment Intent Errors ──────────────────────────────────────────

  describe('IntentNotFoundError', () => {
    it('has correct code and message', () => {
      const error = new IntentNotFoundError('intent-123');
      expect(error.code).toBe('INTENT_NOT_FOUND');
      expect(error.message).toContain('intent-123');
      expect(error.statusCode).toBe(404);
    });
  });

  describe('InvalidTransitionError', () => {
    it('has correct code and message', () => {
      const error = new InvalidTransitionError('CREATED', 'SETTLED');
      expect(error.code).toBe('INVALID_TRANSITION');
      expect(error.message).toContain('CREATED');
      expect(error.message).toContain('SETTLED');
      expect(error.statusCode).toBe(400);
      expect(error.details).toEqual({ from: 'CREATED', to: 'SETTLED' });
    });
  });

  describe('QuoteExpiredError', () => {
    it('has correct code', () => {
      const error = new QuoteExpiredError('intent-123');
      expect(error.code).toBe('QUOTE_EXPIRED');
      expect(error.statusCode).toBe(400);
    });
  });

  describe('MerchantNotFoundError', () => {
    it('has correct code', () => {
      const error = new MerchantNotFoundError('merchant-1');
      expect(error.code).toBe('MERCHANT_NOT_FOUND');
      expect(error.statusCode).toBe(404);
    });
  });

  describe('ValidationError', () => {
    it('has correct code and details', () => {
      const error = new ValidationError('Invalid input', { field: 'amount' });
      expect(error.code).toBe('VALIDATION_ERROR');
      expect(error.statusCode).toBe(400);
      expect(error.details).toEqual({ field: 'amount' });
    });
  });

  // ─── Chain Errors ───────────────────────────────────────────────────

  describe('UnsupportedChainError', () => {
    it('has correct code', () => {
      const error = new UnsupportedChainError('chain-999');
      expect(error.code).toBe('UNSUPPORTED_CHAIN');
      expect(error.statusCode).toBe(400);
    });
  });

  describe('TransactionFailedError', () => {
    it('has correct code and details', () => {
      const error = new TransactionFailedError('0xabc', 'out of gas');
      expect(error.code).toBe('TRANSACTION_FAILED');
      expect(error.statusCode).toBe(500);
    });
  });

  describe('InvalidAddressError', () => {
    it('has correct code', () => {
      const error = new InvalidAddressError('0xbad', 'ethereum');
      expect(error.code).toBe('INVALID_ADDRESS');
      expect(error.statusCode).toBe(400);
    });
  });

  describe('InsufficientGasError', () => {
    it('has correct code', () => {
      const error = new InsufficientGasError('ethereum', '0.1', '0.01');
      expect(error.code).toBe('INSUFFICIENT_GAS');
      expect(error.statusCode).toBe(500);
    });
  });

  describe('RpcError', () => {
    it('has correct code and rpc details', () => {
      const error = new RpcError('ethereum', -32000, 'nonce too low');
      expect(error.code).toBe('RPC_ERROR');
      expect(error.rpcCode).toBe(-32000);
      expect(error.statusCode).toBe(502);
    });
  });

  describe('ReorgDetectedError', () => {
    it('has correct code', () => {
      const error = new ReorgDetectedError('ethereum', '0xabc', 100);
      expect(error.code).toBe('REORG_DETECTED');
      expect(error.statusCode).toBe(500);
    });
  });

  describe('TransactionRevertedError', () => {
    it('has correct code and revert reason', () => {
      const error = new TransactionRevertedError('0xabc', 'ethereum', 'insufficient funds');
      expect(error.code).toBe('TRANSACTION_REVERTED');
      expect(error.txHash).toBe('0xabc');
      expect(error.revertReason).toBe('insufficient funds');
      expect(error.statusCode).toBe(500);
    });
  });

  describe('BalanceQueryError', () => {
    it('has correct code', () => {
      const error = new BalanceQueryError('0xabc', 'ethereum', 'RPC timeout');
      expect(error.code).toBe('BALANCE_QUERY_FAILED');
      expect(error.statusCode).toBe(502);
    });
  });

  describe('DepositWatcherError', () => {
    it('has correct code', () => {
      const error = new DepositWatcherError('0xabc', 'ethereum', 'connection lost');
      expect(error.code).toBe('DEPOSIT_WATCHER_ERROR');
      expect(error.statusCode).toBe(500);
    });
  });

  // ─── Routing Errors ─────────────────────────────────────────────────

  describe('NoValidQuotesError', () => {
    it('has correct code', () => {
      const error = new NoValidQuotesError();
      expect(error.code).toBe('NO_VALID_QUOTES');
      expect(error.statusCode).toBe(400);
    });
  });

  describe('ProviderUnavailableError', () => {
    it('has correct code', () => {
      const error = new ProviderUnavailableError('lifi');
      expect(error.code).toBe('PROVIDER_UNAVAILABLE');
      expect(error.statusCode).toBe(503);
    });
  });

  describe('RouteNotFoundError', () => {
    it('has correct code', () => {
      const error = new RouteNotFoundError('ethereum', 'solana');
      expect(error.code).toBe('ROUTE_NOT_FOUND');
      expect(error.statusCode).toBe(404);
    });
  });

  describe('RouteExpiredError', () => {
    it('has correct code', () => {
      const error = new RouteExpiredError('route-123');
      expect(error.code).toBe('ROUTE_EXPIRED');
      expect(error.statusCode).toBe(400);
    });
  });

  describe('RouteExecutionTimeoutError', () => {
    it('has correct code', () => {
      const error = new RouteExecutionTimeoutError('route-1', 30000);
      expect(error.code).toBe('ROUTE_EXECUTION_TIMEOUT');
      expect(error.statusCode).toBe(408);
    });
  });

  describe('SlippageExceededError', () => {
    it('has correct code', () => {
      const error = new SlippageExceededError(100, 95, 3);
      expect(error.code).toBe('SLIPPAGE_EXCEEDED');
      expect(error.statusCode).toBe(400);
    });
  });

  describe('InsufficientLiquidityError', () => {
    it('has correct code', () => {
      const error = new InsufficientLiquidityError('USDC', 'ethereum', 10000, 5000);
      expect(error.code).toBe('INSUFFICIENT_LIQUIDITY');
      expect(error.statusCode).toBe(400);
    });
  });

  // ─── Settlement Errors ──────────────────────────────────────────────

  describe('SettlementFailedError', () => {
    it('has correct code', () => {
      const error = new SettlementFailedError('settlement-1', 'tx failed');
      expect(error.code).toBe('SETTLEMENT_FAILED');
      expect(error.statusCode).toBe(500);
    });
  });

  describe('InsufficientBalanceError', () => {
    it('has correct code', () => {
      const error = new InsufficientBalanceError('ethereum', 100, 50);
      expect(error.code).toBe('INSUFFICIENT_BALANCE');
      expect(error.statusCode).toBe(500);
    });
  });

  describe('SettlementNotFoundError', () => {
    it('has correct code', () => {
      const error = new SettlementNotFoundError('settlement-1');
      expect(error.code).toBe('SETTLEMENT_NOT_FOUND');
      expect(error.statusCode).toBe(404);
    });
  });

  describe('SettlementAlreadyCompletedError', () => {
    it('has correct code', () => {
      const error = new SettlementAlreadyCompletedError('settlement-1');
      expect(error.code).toBe('SETTLEMENT_ALREADY_COMPLETED');
      expect(error.statusCode).toBe(409);
    });
  });

  describe('LedgerInconsistencyError', () => {
    it('has correct code', () => {
      const error = new LedgerInconsistencyError({ totalDebits: 1000, totalCredits: 950, difference: 50 });
      expect(error.code).toBe('LEDGER_INCONSISTENCY');
      expect(error.statusCode).toBe(500);
    });
  });

  describe('SettlementAmountMismatchError', () => {
    it('has correct code', () => {
      const error = new SettlementAmountMismatchError(100, 95);
      expect(error.code).toBe('SETTLEMENT_AMOUNT_MISMATCH');
      expect(error.statusCode).toBe(400);
    });
  });

  describe('HotWalletInsufficientBalanceError', () => {
    it('has correct code', () => {
      const error = new HotWalletInsufficientBalanceError('ethereum', '10', '5');
      expect(error.code).toBe('HOT_WALLET_INSUFFICIENT_BALANCE');
      expect(error.statusCode).toBe(500);
    });
  });

  // ─── Rate Lock Errors ───────────────────────────────────────────────

  describe('PriceOracleError', () => {
    it('has correct code', () => {
      const error = new PriceOracleError('coingecko', 'rate limited');
      expect(error.code).toBe('PRICE_ORACLE_ERROR');
      expect(error.statusCode).toBe(502);
    });
  });

  describe('PriceStaleError', () => {
    it('has correct code', () => {
      const error = new PriceStaleError('ETH', 'coingecko', 300);
      expect(error.code).toBe('PRICE_STALE');
      expect(error.statusCode).toBe(503);
    });
  });

  describe('PriceConfidenceError', () => {
    it('has correct code', () => {
      const error = new PriceConfidenceError('ETH', 60, 80);
      expect(error.code).toBe('PRICE_LOW_CONFIDENCE');
      expect(error.statusCode).toBe(503);
    });
  });

  describe('RateLockExpiredError', () => {
    it('has correct code', () => {
      const error = new RateLockExpiredError('lock-1', 'intent-1');
      expect(error.code).toBe('RATE_LOCK_EXPIRED');
      expect(error.statusCode).toBe(400);
    });
  });

  describe('RateLockNotFoundError', () => {
    it('has correct code', () => {
      const error = new RateLockNotFoundError('intent-1');
      expect(error.code).toBe('RATE_LOCK_NOT_FOUND');
      expect(error.statusCode).toBe(404);
    });
  });

  describe('RateLockAlreadyConsumedError', () => {
    it('has correct code', () => {
      const error = new RateLockAlreadyConsumedError('lock-1');
      expect(error.code).toBe('RATE_LOCK_ALREADY_CONSUMED');
      expect(error.statusCode).toBe(409);
    });
  });

  describe('SpreadExceededError', () => {
    it('has correct code', () => {
      const error = new SpreadExceededError(500, 200);
      expect(error.code).toBe('SPREAD_EXCEEDED');
      expect(error.statusCode).toBe(400);
    });
  });

  describe('RiskScoringError', () => {
    it('has correct code', () => {
      const error = new RiskScoringError('0xabc', 'API timeout');
      expect(error.code).toBe('RISK_SCORING_ERROR');
      expect(error.statusCode).toBe(500);
    });
  });

  describe('SanctionsCheckError', () => {
    it('has correct code', () => {
      const error = new SanctionsCheckError('0xabc', 'chainalysis', 'service down');
      expect(error.code).toBe('SANCTIONS_CHECK_ERROR');
      expect(error.statusCode).toBe(503);
    });
  });

  describe('AddressBlockedError', () => {
    it('has correct code', () => {
      const error = new AddressBlockedError('0xabc', 'sanctions match', 100);
      expect(error.code).toBe('ADDRESS_BLOCKED');
      expect(error.statusCode).toBe(403);
    });
  });

  describe('ComplianceGateError', () => {
    it('has correct code', () => {
      const error = new ComplianceGateError('0xabc', 'blocked by policy');
      expect(error.code).toBe('COMPLIANCE_GATE_BLOCKED');
      expect(error.statusCode).toBe(403);
    });
  });

  describe('TreasuryInsufficientError', () => {
    it('has correct code', () => {
      const error = new TreasuryInsufficientError('ethereum', 'USDC', 10000, 5000);
      expect(error.code).toBe('TREASURY_INSUFFICIENT');
      expect(error.statusCode).toBe(500);
    });
  });

  describe('TreasuryReplenishmentError', () => {
    it('has correct code', () => {
      const error = new TreasuryReplenishmentError('ethereum', 'RPC timeout');
      expect(error.code).toBe('TREASURY_REPLENISHMENT_FAILED');
      expect(error.statusCode).toBe(500);
    });
  });

  // ─── Compliance Errors ──────────────────────────────────────────────

  describe('SanctionedAddressError', () => {
    it('has correct code', () => {
      const error = new SanctionedAddressError('0xabc');
      expect(error.code).toBe('SANCTIONED_ADDRESS');
      expect(error.statusCode).toBe(403);
    });
  });

  describe('ComplianceCheckFailedError', () => {
    it('has correct code', () => {
      const error = new ComplianceCheckFailedError('service unavailable');
      expect(error.code).toBe('COMPLIANCE_CHECK_FAILED');
      expect(error.statusCode).toBe(403);
    });
  });
});
