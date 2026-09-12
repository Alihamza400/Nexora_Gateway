/**
 * Custom error classes for the crypto gateway.
 * All errors extend a base GatewayError for consistent error handling.
 */

export { GatewayError } from './gateway-error.js';
import { GatewayError } from './gateway-error.js';

// ─── Payment Intent Errors ───────────────────────────────────────────────────

export class IntentNotFoundError extends GatewayError {
  constructor(intentId: string) {
    super('INTENT_NOT_FOUND', `Payment intent not found: ${intentId}`, 404);
  }
}

export class InvalidTransitionError extends GatewayError {
  constructor(from: string, to: string) {
    super('INVALID_TRANSITION', `Invalid state transition from ${from} to ${to}`, 400, {
      from,
      to,
    });
  }
}

export class QuoteExpiredError extends GatewayError {
  constructor(intentId: string) {
    super('QUOTE_EXPIRED', `Quote has expired for intent: ${intentId}`, 400);
  }
}

export class MerchantNotFoundError extends GatewayError {
  constructor(merchantId: string) {
    super('MERCHANT_NOT_FOUND', `Merchant not found: ${merchantId}`, 404);
  }
}

export class ValidationError extends GatewayError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('VALIDATION_ERROR', message, 400, details);
  }
}

// ─── Chain Errors ────────────────────────────────────────────────────────────

export class UnsupportedChainError extends GatewayError {
  constructor(chainId: string) {
    super('UNSUPPORTED_CHAIN', `Chain not supported: ${chainId}`, 400);
  }
}

export class TransactionFailedError extends GatewayError {
  constructor(txHash: string, reason?: string) {
    super('TRANSACTION_FAILED', `Transaction failed: ${txHash}`, 500, { reason });
  }
}

// ─── Routing Errors ──────────────────────────────────────────────────────────

export class NoValidQuotesError extends GatewayError {
  constructor() {
    super('NO_VALID_QUOTES', 'No valid quotes available from any provider', 400);
  }
}

export class ProviderUnavailableError extends GatewayError {
  constructor(providerName: string) {
    super('PROVIDER_UNAVAILABLE', `Provider unavailable: ${providerName}`, 503);
  }
}

// ─── Settlement Errors ───────────────────────────────────────────────────────

export class SettlementFailedError extends GatewayError {
  constructor(settlementId: string, reason?: string) {
    super('SETTLEMENT_FAILED', `Settlement failed: ${settlementId}`, 500, { reason });
  }
}

export class InsufficientBalanceError extends GatewayError {
  constructor(chain: string, required: number, available: number) {
    super('INSUFFICIENT_BALANCE', `Insufficient balance on ${chain}`, 500, {
      chain,
      required,
      available,
    });
  }
}

// ─── Compliance Errors ───────────────────────────────────────────────────────

export class SanctionedAddressError extends GatewayError {
  constructor(address: string) {
    super('SANCTIONED_ADDRESS', `Address is sanctioned: ${address}`, 403);
  }
}

export class ComplianceCheckFailedError extends GatewayError {
  constructor(reason: string) {
    super('COMPLIANCE_CHECK_FAILED', `Compliance check failed: ${reason}`, 403);
  }
}

export class ScreeningUnavailableError extends GatewayError {
  constructor(provider: string, reason: string) {
    super(
      'SCREENING_UNAVAILABLE',
      `Screening provider ${provider} is unavailable: ${reason}. Payment cannot proceed (fail-closed).`,
      503,
      { provider, reason },
    );
  }
}

// Re-export rate-lock and risk errors
export * from './rate-lock-errors.js';
export * from './chain-errors.js';
export * from './settlement-errors.js';
export * from './routing-errors.js';
