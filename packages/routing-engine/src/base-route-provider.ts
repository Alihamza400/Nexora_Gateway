/**
 * Base Route Provider
 *
 * Abstract adapter that normalizes raw provider responses into the
 * unified RouteQuote format. Concrete providers implement the abstract
 * methods to handle provider-specific API quirks.
 *
 * Pattern: Template Method
 *   - quote() calls fetchRawQuote() then normalizeQuote()
 *   - execute() calls executeRaw() then normalizeResult()
 */

import type {
  IRouteProvider,
  RouteQuote,
  RouteQuoteParams,
  RouteExecutionResult,
} from '@crypto-gateway/shared';
import { CircuitBreaker, CircuitOpenError } from './circuit-breaker.js';

export abstract class BaseRouteProvider implements IRouteProvider {
  protected readonly circuitBreaker: CircuitBreaker;

  constructor(name: string, circuitBreakerOptions?: { failureThreshold?: number; recoveryTimeout?: number }) {
    this.circuitBreaker = new CircuitBreaker(circuitBreakerOptions);
    void name; // Used by concrete providers via getName()
  }

  abstract getName(): string;
  abstract getSupportedChains(): string[];
  abstract getSupportedAssets(chain: string): string[];

  /**
   * Fetch a quote with circuit breaker protection.
   * Handles raw API call + normalization.
   */
  async quote(params: RouteQuoteParams): Promise<RouteQuote> {
    return this.circuitBreaker.execute(async () => {
      const rawQuote = await this.fetchRawQuote(params);
      return this.normalizeQuote(rawQuote, params);
    });
  }

  /**
   * Execute a route with circuit breaker protection.
   */
  async execute(route: RouteQuote): Promise<RouteExecutionResult> {
    return this.circuitBreaker.execute(async () => {
      const rawResult = await this.executeRaw(route);
      return this.normalizeResult(rawResult);
    });
  }

  /**
   * Get execution status from the provider.
   */
  async getStatus(executionId: string): Promise<'PENDING' | 'EXECUTING' | 'COMPLETED' | 'FAILED' | 'REFUNDED'> {
    return this.fetchStatus(executionId);
  }

  /**
   * Check if provider circuit is healthy.
   */
  isHealthy(): boolean {
    return this.circuitBreaker.getState() !== 'OPEN';
  }

  /**
   * Get circuit breaker state for monitoring.
   */
  getCircuitState(): 'CLOSED' | 'OPEN' | 'HALF_OPEN' {
    return this.circuitBreaker.getState();
  }

  /**
   * Reset circuit breaker (for manual recovery).
   */
  resetCircuit(): void {
    this.circuitBreaker.reset();
  }

  // ─── Abstract methods for concrete providers ─────────────────────────────

  /**
   * Fetch raw quote from provider API.
   * Must be implemented by concrete providers.
   */
  protected abstract fetchRawQuote(params: RouteQuoteParams): Promise<unknown>;

  /**
   * Normalize raw provider response into RouteQuote.
   * Must be implemented by concrete providers.
   */
  protected abstract normalizeQuote(raw: unknown, params: RouteQuoteParams): Promise<RouteQuote>;

  /**
   * Execute route via provider API.
   * Must be implemented by concrete providers.
   */
  protected abstract executeRaw(route: RouteQuote): Promise<unknown>;

  /**
   * Normalize raw execution result into RouteExecutionResult.
   * Must be implemented by concrete providers.
   */
  protected abstract normalizeResult(raw: unknown): Promise<RouteExecutionResult>;

  /**
   * Fetch execution status from provider API.
   * Must be implemented by concrete providers.
   */
  protected abstract fetchStatus(executionId: string): Promise<RouteExecutionResult['status']>;
}

/**
 * Check if an error is from circuit breaker being open.
 */
export function isCircuitOpenError(error: unknown): error is CircuitOpenError {
  return error instanceof CircuitOpenError;
}
