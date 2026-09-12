/**
 * Worker-specific error types.
 *
 * These extend the shared GatewayError so the API/gateway and the worker present a
 * consistent error shape, and so callers can distinguish "misconfigured" from
 * "transient failure" without string matching.
 */

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

export class JobHandlerMissingError extends Error {
  constructor(jobType: string) {
    super(`No handler registered for job type "${jobType}"`);
    this.name = 'JobHandlerMissingError';
  }
}

/**
 * Raised when a deposit cannot be attributed to any intent.
 *
 * This is a business condition, not a bug: a customer sent funds to an address
 * that is not expecting them. It must be recorded so it can be investigated, never
 * silently dropped.
 */
export class UnattributedDepositError extends Error {
  constructor(chainId: string, address: string, txHash: string) {
    super(`No intent awaiting a deposit at ${address} on chain ${chainId} (tx ${txHash})`);
    this.name = 'UnattributedDepositError';
  }
}
