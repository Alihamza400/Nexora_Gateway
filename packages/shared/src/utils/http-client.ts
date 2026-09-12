/**
 * Shared HTTP Client
 *
 * Production-grade HTTP client with:
 * - Configurable timeout via AbortSignal
 * - Retry with jittered exponential backoff
 * - Request-id propagation
 * - API key redaction from logs
 * - Typed errors for HTTP failures
 *
 * Used by all external adapters (routing, compliance, oracles, gas abstraction).
 */

import { GatewayError } from '../errors/gateway-error.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface HttpClientConfig {
  baseUrl: string;
  apiKey?: string;
  apiKeyHeader?: string;
  timeoutMs?: number;
  maxRetries?: number;
  baseRetryDelayMs?: number;
  maxRetryDelayMs?: number;
  userAgent?: string;
  extraHeaders?: Record<string, string>;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  path?: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
  idempotent?: boolean;
  requestId?: string;
}

export interface HttpResponse<T = unknown> {
  status: number;
  headers: Record<string, string>;
  data: T;
  requestId: string;
}

// ─── Errors ──────────────────────────────────────────────────────────────────

export class HttpError extends GatewayError {
  public readonly status: number;
  public readonly responseBody?: unknown;
  public readonly requestId: string;

  constructor(status: number, message: string, requestId: string, body?: unknown) {
    super('HTTP_ERROR', message, status >= 500 ? 502 : status, { status, requestId });
    this.name = 'HttpError';
    this.status = status;
    this.responseBody = body;
    this.requestId = requestId;
  }
}

export class HttpTimeoutError extends GatewayError {
  public readonly timeoutMs: number;
  public readonly requestId: string;

  constructor(url: string, timeoutMs: number, requestId: string) {
    super('HTTP_TIMEOUT', `Request to ${redactUrl(url)} timed out after ${timeoutMs}ms`, 504, {
      url: redactUrl(url),
      timeoutMs,
      requestId,
    });
    this.name = 'HttpTimeoutError';
    this.timeoutMs = timeoutMs;
    this.requestId = requestId;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

let requestCounter = 0;

function generateRequestId(): string {
  requestCounter++;
  return `req_${Date.now()}_${requestCounter}`;
}

/**
 * Redact API keys and sensitive query params from URLs for logging.
 */
function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const sensitiveParams = ['apikey', 'api_key', 'key', 'token', 'secret', 'access_token'];
    for (const param of sensitiveParams) {
      if (parsed.searchParams.has(param)) {
        parsed.searchParams.set(param, '***REDACTED***');
      }
    }
    return parsed.toString();
  } catch {
    return url.replace(
      /[?&](apikey|api_key|key|token|secret|access_token)=[^&]*/gi,
      '&$1=***REDACTED***',
    );
  }
}

/**
 * Build query string from params, skipping undefined values.
 */
function buildQueryString(query?: Record<string, string | number | boolean | undefined>): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) {
      params.set(key, String(value));
    }
  }
  const str = params.toString();
  return str ? `?${str}` : '';
}

/**
 * Sleep with jittered backoff.
 */
function backoffDelay(attempt: number, baseMs: number, maxMs: number): number {
  const exponential = baseMs * Math.pow(2, attempt);
  const jitter = Math.random() * baseMs;
  return Math.min(exponential + jitter, maxMs);
}

/**
 * Check if a status code is retryable (429, 502, 503, 504).
 */
function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

// ─── HTTP Client ─────────────────────────────────────────────────────────────

export class HttpClient {
  private readonly config: Required<HttpClientConfig>;

  constructor(config: HttpClientConfig) {
    this.config = {
      baseUrl: config.baseUrl.replace(/\/$/, ''),
      apiKey: config.apiKey ?? '',
      apiKeyHeader: config.apiKeyHeader ?? 'Authorization',
      timeoutMs: config.timeoutMs ?? 10_000,
      maxRetries: config.maxRetries ?? 3,
      baseRetryDelayMs: config.baseRetryDelayMs ?? 1_000,
      maxRetryDelayMs: config.maxRetryDelayMs ?? 10_000,
      userAgent: config.userAgent ?? 'NexoraCryptoGateway/1.0',
      extraHeaders: config.extraHeaders ?? {},
    };
  }

  /**
   * Make an HTTP request with retry, timeout, and error handling.
   */
  async request<T = unknown>(options: RequestOptions): Promise<HttpResponse<T>> {
    const requestId = options.requestId ?? generateRequestId();
    const method = options.method ?? 'GET';
    const url = `${this.config.baseUrl}${options.path ?? ''}${buildQueryString(options.query)}`;

    const headers: Record<string, string> = {
      'User-Agent': this.config.userAgent,
      'X-Request-ID': requestId,
      Accept: 'application/json',
      ...this.config.extraHeaders,
      ...options.headers,
    };

    // Add API key if configured and not already set
    if (this.config.apiKey && !headers[this.config.apiKeyHeader]) {
      headers[this.config.apiKeyHeader] = this.config.apiKey;
    }

    // Content-Type for body requests
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    const timeoutMs = options.timeoutMs ?? this.config.timeoutMs;
    const maxRetries = options.idempotent === false ? 0 : this.config.maxRetries;

    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        try {
          const response = await fetch(url, {
            method,
            headers,
            body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
            signal: controller.signal,
          });

          clearTimeout(timeoutId);

          // Parse response
          let responseData: T;
          const contentType = response.headers.get('content-type') ?? '';
          if (contentType.includes('application/json')) {
            responseData = (await response.json()) as T;
          } else {
            responseData = (await response.text()) as unknown as T;
          }

          // Build response headers map
          const responseHeaders: Record<string, string> = {};
          response.headers.forEach((value, key) => {
            responseHeaders[key] = value;
          });

          // Handle HTTP errors
          if (!response.ok) {
            const error = new HttpError(
              response.status,
              `HTTP ${response.status} ${response.statusText} from ${redactUrl(url)}`,
              requestId,
              responseData,
            );

            // Retry on 429, 502, 503, 504
            if (isRetryableStatus(response.status) && attempt < maxRetries) {
              // Respect Retry-After header
              const retryAfter = response.headers.get('retry-after');
              const retryMs = retryAfter
                ? parseInt(retryAfter, 10) * 1000
                : backoffDelay(attempt, this.config.baseRetryDelayMs, this.config.maxRetryDelayMs);
              await sleep(retryMs);
              lastError = error;
              continue;
            }

            throw error;
          }

          return {
            status: response.status,
            headers: responseHeaders,
            data: responseData,
            requestId,
          };
        } finally {
          clearTimeout(timeoutId);
        }
      } catch (error) {
        if (error instanceof HttpError) {
          throw error;
        }

        // Timeout or network error
        if (error instanceof DOMException && error.name === 'AbortError') {
          throw new HttpTimeoutError(url, timeoutMs, requestId);
        }

        lastError = error as Error;

        // Retry on network errors
        if (attempt < maxRetries) {
          const delay = backoffDelay(
            attempt,
            this.config.baseRetryDelayMs,
            this.config.maxRetryDelayMs,
          );
          await sleep(delay);
          continue;
        }
      }
    }

    throw lastError ?? new Error('Request failed after all retries');
  }

  /**
   * Convenience method for GET requests.
   */
  async get<T = unknown>(
    path: string,
    options?: Omit<RequestOptions, 'method' | 'path'>,
  ): Promise<HttpResponse<T>> {
    return this.request<T>({ ...options, method: 'GET', path });
  }

  /**
   * Convenience method for POST requests.
   */
  async post<T = unknown>(
    path: string,
    body?: unknown,
    options?: Omit<RequestOptions, 'method' | 'path' | 'body'>,
  ): Promise<HttpResponse<T>> {
    return this.request<T>({ ...options, method: 'POST', path, body });
  }

  /**
   * Convenience method for PUT requests.
   */
  async put<T = unknown>(
    path: string,
    body?: unknown,
    options?: Omit<RequestOptions, 'method' | 'path' | 'body'>,
  ): Promise<HttpResponse<T>> {
    return this.request<T>({ ...options, method: 'PUT', path, body });
  }

  /**
   * Convenience method for DELETE requests.
   */
  async delete<T = unknown>(
    path: string,
    options?: Omit<RequestOptions, 'method' | 'path'>,
  ): Promise<HttpResponse<T>> {
    return this.request<T>({ ...options, method: 'DELETE', path });
  }

  /**
   * Get the base URL for health checks.
   */
  getBaseUrl(): string {
    return this.config.baseUrl;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
