/**
 * Routing-specific error classes.
 */

import { GatewayError } from './gateway-error.js';

export class RouteNotFoundError extends GatewayError {
  constructor(sourceChain: string, targetChain: string) {
    super(
      'ROUTE_NOT_FOUND',
      `No route found from ${sourceChain} to ${targetChain}`,
      404,
      { sourceChain, targetChain },
    );
  }
}

export class RouteExpiredError extends GatewayError {
  constructor(routeId: string) {
    super('ROUTE_EXPIRED', `Route quote has expired: ${routeId}`, 400);
  }
}

export class RouteExecutionTimeoutError extends GatewayError {
  constructor(routeId: string, timeoutMs: number) {
    super(
      'ROUTE_EXECUTION_TIMEOUT',
      `Route execution timed out after ${timeoutMs}ms: ${routeId}`,
      408,
      { routeId, timeoutMs },
    );
  }
}

export class SlippageExceededError extends GatewayError {
  constructor(expected: number, actual: number, maxSlippage: number) {
    super(
      'SLIPPAGE_EXCEEDED',
      `Slippage ${Math.abs(actual - expected)} exceeds maximum ${maxSlippage}`,
      400,
      { expected, actual, maxSlippage },
    );
  }
}

export class InsufficientLiquidityError extends GatewayError {
  constructor(asset: string, chain: string, required: number, available: number) {
    super(
      'INSUFFICIENT_LIQUIDITY',
      `Insufficient liquidity for ${asset} on ${chain}`,
      400,
      { asset, chain, required, available },
    );
  }
}
