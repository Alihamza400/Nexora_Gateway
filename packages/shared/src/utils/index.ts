import { randomUUID } from 'crypto';

export { HttpClient, HttpError, HttpTimeoutError } from './http-client.js';
export type { HttpClientConfig, RequestOptions, HttpResponse } from './http-client.js';

/**
 * Generate a UUID v4.
 */
export function generateId(): string {
  return randomUUID();
}

/**
 * Validate that a state transition is allowed.
 */
export function isValidTransition(
  validTransitions: Record<string, string[]>,
  from: string,
  to: string,
): boolean {
  return validTransitions[from]?.includes(to) ?? false;
}

/**
 * Sleep for a given number of milliseconds.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry a function with exponential backoff.
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelayMs: number = 1000,
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      if (attempt === maxRetries) {
        break;
      }

      const delay = baseDelayMs * Math.pow(2, attempt);
      await sleep(delay);
    }
  }

  throw lastError;
}

/**
 * Normalize a fee score (lower fee = higher score).
 */
export function normalizeFeeScore(fee: number, maxFee: number): number {
  return Math.max(0, 1 - fee / maxFee);
}

/**
 * Normalize a time score (lower time = higher score).
 */
export function normalizeTimeScore(time: number, maxTime: number): number {
  return Math.max(0, 1 - time / maxTime);
}

/**
 * Validate an amount is within acceptable bounds.
 */
export function isValidAmount(
  amount: number,
  min: number = 0,
  max: number = Number.MAX_SAFE_INTEGER,
): boolean {
  return typeof amount === 'number' && !isNaN(amount) && amount >= min && amount <= max;
}

/**
 * Validate a blockchain address format (basic validation).
 */
export function isValidEvmAddress(address: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(address);
}

/**
 * Sleep for a random jittered delay (for retry jitter).
 */
export function jitteredDelay(baseMs: number, maxJitterMs: number = 500): Promise<void> {
  const jitter = Math.random() * maxJitterMs;
  return sleep(baseMs + jitter);
}
