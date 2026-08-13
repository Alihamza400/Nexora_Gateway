/**
 * Route Engine
 *
 * Main orchestrator for route selection and execution.
 * Fetches quotes from all providers in parallel, scores them,
 * and selects the optimal route based on merchant preferences.
 *
 * Flow:
 *   1. Get supported providers for chain pair
 *   2. Fetch quotes in parallel with timeout
 *   3. Filter expired/failed quotes
 *   4. Score and rank remaining quotes
 *   5. Select best route
 *   6. Execute route through selected provider
 */

import type {
  IRouteProvider,
  RouteQuote,
  RouteQuoteParams,
  RouteExecutionResult,
  MerchantPreferences,
} from '@crypto-gateway/shared';
import { NoValidQuotesError, ProviderUnavailableError } from '@crypto-gateway/shared';
import { RouteScorer } from './route-scorer.js';
import { ProviderRegistry } from './provider-registry.js';
import { isCircuitOpenError } from './base-route-provider.js';

export interface RouteEngineConfig {
  /** Maximum time to wait for quotes (ms) */
  quoteTimeoutMs: number;
  /** Minimum number of successful quotes required */
  minQuotesRequired: number;
  /** Whether to skip providers with open circuits */
  skipOpenCircuits: boolean;
}

const DEFAULT_ENGINE_CONFIG: RouteEngineConfig = {
  quoteTimeoutMs: 5000,    // 5 seconds
  minQuotesRequired: 1,
  skipOpenCircuits: true,
};

export class RouteEngine {
  private readonly registry: ProviderRegistry;
  private readonly scorer: RouteScorer;
  private readonly config: RouteEngineConfig;

  constructor(
    registry: ProviderRegistry,
    preferences?: Partial<MerchantPreferences>,
    config?: Partial<RouteEngineConfig>,
  ) {
    this.registry = registry;
    this.scorer = new RouteScorer(preferences);
    this.config = { ...DEFAULT_ENGINE_CONFIG, ...config };
  }

  /**
   * Select the best route for a payment intent.
   *
   * Fetches quotes from all supported providers in parallel,
   * scores them, and returns the optimal route.
   */
  async selectBestRoute(params: RouteQuoteParams): Promise<{ quote: RouteQuote; score: import('@crypto-gateway/shared').RouteScore }> {
    // 1. Get supported providers
    let providers = this.registry.getSupportedProviders(
      params.source_chain,
      params.target_chain,
    );

    // 2. Optionally skip unhealthy providers
    if (this.config.skipOpenCircuits) {
      providers = providers.filter((p) => {
        if (typeof (p as unknown as { isHealthy: () => boolean }).isHealthy === 'function') {
          return (p as unknown as { isHealthy: () => boolean }).isHealthy();
        }
        return true;
      });
    }

    if (providers.length === 0) {
      throw new NoValidQuotesError();
    }

    // 3. Fetch quotes in parallel with timeout
    const quotes = await this.fetchQuotesParallel(providers, params);

    // 4. Filter expired quotes
    const validQuotes = quotes.filter((q) => q.expires_at > new Date());

    if (validQuotes.length < this.config.minQuotesRequired) {
      throw new NoValidQuotesError();
    }

    // 5. Score and select best route
    const result = this.scorer.selectBest(validQuotes);
    if (!result) {
      throw new NoValidQuotesError();
    }

    return result;
  }

  /**
   * Execute a selected route.
   */
  async executeRoute(quote: RouteQuote): Promise<RouteExecutionResult> {
    const provider = this.registry.get(quote.provider);
    if (!provider) {
      throw new ProviderUnavailableError(quote.provider);
    }

    return provider.execute(quote);
  }

  /**
   * Get execution status from the provider.
   */
  async getExecutionStatus(
    providerName: string,
    executionId: string,
  ): Promise<'PENDING' | 'EXECUTING' | 'COMPLETED' | 'FAILED' | 'REFUNDED'> {
    const provider = this.registry.get(providerName);
    if (!provider) {
      throw new ProviderUnavailableError(providerName);
    }

    return provider.getStatus(executionId);
  }

  /**
   * Get all available routes (for comparison).
   */
  async getAllRoutes(params: RouteQuoteParams): Promise<Array<{ quote: RouteQuote; score: import('@crypto-gateway/shared').RouteScore }>> {
    const providers = this.registry.getSupportedProviders(
      params.source_chain,
      params.target_chain,
    );

    if (providers.length === 0) {
      return [];
    }

    const quotes = await this.fetchQuotesParallel(providers, params);
    const validQuotes = quotes.filter((q) => q.expires_at > new Date());

    return this.scorer.rank(validQuotes);
  }

  /**
   * Get the scorer for external use.
   */
  getScorer(): RouteScorer {
    return this.scorer;
  }

  /**
   * Get the provider registry.
   */
  getRegistry(): ProviderRegistry {
    return this.registry;
  }

  // ─── Private Methods ─────────────────────────────────────────────────────

  /**
   * Fetch quotes from all providers in parallel with timeout.
   * Uses Promise.allSettled to handle individual provider failures.
   */
  private async fetchQuotesParallel(
    providers: IRouteProvider[],
    params: RouteQuoteParams,
  ): Promise<RouteQuote[]> {
    const quotePromises = providers.map(async (provider) => {
      try {
        return await Promise.race([
          provider.quote(params),
          this.createTimeout(this.config.quoteTimeoutMs, provider.getName()),
        ]);
      } catch (error) {
        // Log but don't fail - we want partial results
        if (isCircuitOpenError(error)) {
          // Circuit is open, provider is unhealthy
          return null;
        }
        if (error instanceof Error && error.name === 'TimeoutError') {
          // Provider timed out
          return null;
        }
        // Other errors (API failures, etc.)
        return null;
      }
    });

    const results = await Promise.allSettled(quotePromises);

    return results
      .filter(
        (result): result is PromiseFulfilledResult<RouteQuote | null> =>
          result.status === 'fulfilled',
      )
      .map((result) => result.value)
      .filter((quote): quote is RouteQuote => quote !== null);
  }

  /**
   * Create a timeout promise that rejects with TimeoutError.
   */
  private createTimeout(ms: number, providerName: string): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => {
        const error = new Error(`Quote timeout from ${providerName} after ${ms}ms`);
        error.name = 'TimeoutError';
        reject(error);
      }, ms);
    });
  }
}
