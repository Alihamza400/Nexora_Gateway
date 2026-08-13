/**
 * Circuit Breaker
 *
 * Protects against cascading failures when a provider is unhealthy.
 *
 * States:
 *   CLOSED   → Normal operation, requests pass through
 *   OPEN     → Provider is down, requests fail immediately
 *   HALF_OPEN → Testing if provider recovered, allows one request
 *
 * Transitions:
 *   CLOSED → OPEN: after `failureThreshold` consecutive failures
 *   OPEN → HALF_OPEN: after `recoveryTimeout` ms
 *   HALF_OPEN → CLOSED: on success
 *   HALF_OPEN → OPEN: on failure
 */

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerOptions {
  /** Number of consecutive failures before opening the circuit */
  failureThreshold: number;
  /** Time in ms to wait before transitioning from OPEN to HALF_OPEN */
  recoveryTimeout: number;
}

const DEFAULT_OPTIONS: CircuitBreakerOptions = {
  failureThreshold: 5,
  recoveryTimeout: 30_000, // 30 seconds
};

export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failures = 0;
  private lastFailureTime: number | null = null;
  private readonly options: CircuitBreakerOptions;

  constructor(options?: Partial<CircuitBreakerOptions>) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Execute a function through the circuit breaker.
   * Throws immediately if circuit is OPEN.
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      if (this.shouldAttemptRecovery()) {
        this.state = 'HALF_OPEN';
      } else {
        throw new CircuitOpenError(this.getRemainingRecoveryTime());
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  /**
   * Get current circuit state.
   */
  getState(): CircuitState {
    // Check if OPEN should transition to HALF_OPEN
    if (this.state === 'OPEN' && this.shouldAttemptRecovery()) {
      this.state = 'HALF_OPEN';
    }
    return this.state;
  }

  /**
   * Get failure count.
   */
  getFailureCount(): number {
    return this.failures;
  }

  /**
   * Manually reset the circuit to CLOSED.
   */
  reset(): void {
    this.state = 'CLOSED';
    this.failures = 0;
    this.lastFailureTime = null;
  }

  /**
   * Handle successful execution.
   */
  private onSuccess(): void {
    this.failures = 0;
    this.state = 'CLOSED';
    this.lastFailureTime = null;
  }

  /**
   * Handle failed execution.
   */
  private onFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();

    if (this.failures >= this.options.failureThreshold) {
      this.state = 'OPEN';
    }
  }

  /**
   * Check if enough time has passed to attempt recovery.
   */
  private shouldAttemptRecovery(): boolean {
    if (!this.lastFailureTime) return false;
    return Date.now() - this.lastFailureTime >= this.options.recoveryTimeout;
  }

  /**
   * Get remaining time before recovery attempt (ms).
   */
  private getRemainingRecoveryTime(): number {
    if (!this.lastFailureTime) return 0;
    const elapsed = Date.now() - this.lastFailureTime;
    return Math.max(0, this.options.recoveryTimeout - elapsed);
  }
}

/**
 * Error thrown when circuit is OPEN.
 */
export class CircuitOpenError extends Error {
  constructor(public readonly retryAfterMs: number) {
    super(`Circuit breaker is OPEN. Retry after ${retryAfterMs}ms`);
    this.name = 'CircuitOpenError';
  }
}
