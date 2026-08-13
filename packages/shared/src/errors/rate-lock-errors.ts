/**
 * Rate Lock & Risk Scoring error classes.
 */

import { GatewayError } from './gateway-error.js';

// ─── Price Oracle Errors ─────────────────────────────────────────────────────

export class PriceOracleError extends GatewayError {
  constructor(oracle: string, reason: string) {
    super(
      'PRICE_ORACLE_ERROR',
      `Price oracle "${oracle}" failed: ${reason}`,
      502,
      { oracle, reason },
    );
  }
}

export class PriceStaleError extends GatewayError {
  constructor(asset: string, source: string, ageSeconds: number) {
    super(
      'PRICE_STALE',
      `Price for ${asset} from ${source} is stale (${ageSeconds}s old)`,
      503,
      { asset, source, ageSeconds },
    );
  }
}

export class PriceConfidenceError extends GatewayError {
  constructor(asset: string, confidence: number, minRequired: number) {
    super(
      'PRICE_LOW_CONFIDENCE',
      `Price confidence for ${asset} is ${confidence}, minimum required is ${minRequired}`,
      503,
      { asset, confidence, minRequired },
    );
  }
}

// ─── Rate Lock Errors ────────────────────────────────────────────────────────

export class RateLockExpiredError extends GatewayError {
  constructor(lockId: string, intentId: string) {
    super(
      'RATE_LOCK_EXPIRED',
      `Rate lock ${lockId} has expired for intent ${intentId}`,
      400,
      { lockId, intentId },
    );
  }
}

export class RateLockNotFoundError extends GatewayError {
  constructor(intentId: string) {
    super(
      'RATE_LOCK_NOT_FOUND',
      `No rate lock found for intent ${intentId}`,
      404,
      { intentId },
    );
  }
}

export class RateLockAlreadyConsumedError extends GatewayError {
  constructor(lockId: string) {
    super(
      'RATE_LOCK_ALREADY_CONSUMED',
      `Rate lock ${lockId} has already been consumed`,
      409,
      { lockId },
    );
  }
}

export class SpreadExceededError extends GatewayError {
  constructor(spreadBps: number, maxBps: number) {
    super(
      'SPREAD_EXCEEDED',
      `Spread ${spreadBps}bps exceeds maximum allowed ${maxBps}bps`,
      400,
      { spreadBps, maxBps },
    );
  }
}

// ─── Risk Scoring Errors ─────────────────────────────────────────────────────

export class RiskScoringError extends GatewayError {
  constructor(address: string, reason: string) {
    super(
      'RISK_SCORING_ERROR',
      `Risk scoring failed for address ${address}: ${reason}`,
      500,
      { address, reason },
    );
  }
}

export class SanctionsCheckError extends GatewayError {
  constructor(address: string, provider: string, reason: string) {
    super(
      'SANCTIONS_CHECK_ERROR',
      `Sanctions check failed for ${address} via ${provider}: ${reason}`,
      503,
      { address, provider, reason },
    );
  }
}

export class AddressBlockedError extends GatewayError {
  constructor(address: string, reason: string, riskScore: number) {
    super(
      'ADDRESS_BLOCKED',
      `Address ${address} is blocked: ${reason}`,
      403,
      { address, reason, riskScore },
    );
  }
}

export class ComplianceGateError extends GatewayError {
  constructor(address: string, reason: string) {
    super(
      'COMPLIANCE_GATE_BLOCKED',
      `Compliance gate blocked ${address}: ${reason}`,
      403,
      { address, reason },
    );
  }
}

// ─── Treasury Errors ─────────────────────────────────────────────────────────

export class TreasuryInsufficientError extends GatewayError {
  constructor(chain: string, asset: string, required: number, available: number) {
    super(
      'TREASURY_INSUFFICIENT',
      `Treasury insufficient on ${chain} for ${asset}: need ${required}, have ${available}`,
      500,
      { chain, asset, required, available },
    );
  }
}

export class TreasuryReplenishmentError extends GatewayError {
  constructor(chain: string, reason: string) {
    super(
      'TREASURY_REPLENISHMENT_FAILED',
      `Treasury replenishment failed on ${chain}: ${reason}`,
      500,
      { chain, reason },
    );
  }
}
