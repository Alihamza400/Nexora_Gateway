import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RouteEngine } from './route-engine.js';
import { ProviderRegistry } from './provider-registry.js';
import { CircuitBreaker } from './circuit-breaker.js';
import type { IRouteProvider, RouteQuote, RouteQuoteParams, RouteExecutionResult, MerchantPreferences } from '@crypto-gateway/shared';
import { NoValidQuotesError, ProviderUnavailableError } from '@crypto-gateway/shared';

// ─── Mock Provider Factory ──────────────────────────────────────────────

function createMockProvider(
  name: string,
  chains: string[],
  quoteResult?: Partial<RouteQuote>,
  quoteFn?: (params: RouteQuoteParams) => Promise<RouteQuote>,
): IRouteProvider & { circuitBreaker: CircuitBreaker } {
  const cb = new CircuitBreaker({ failureThreshold: 5, recoveryTimeout: 30000 });
  const provider = {
    getName: () => name,
    getSupportedChains: () => chains,
    getSupportedAssets: (_chain: string) => ['USDC', 'USDT', 'ETH'],
    quote: quoteFn
      ? quoteFn
      : vi.fn(async (params: RouteQuoteParams): Promise<RouteQuote> => ({
          id: `quote-${name}-${Date.now()}`,
          provider: name,
          source_chain: params.source_chain,
          source_asset: params.source_asset,
          source_amount: params.source_amount,
          target_chain: params.target_chain,
          target_asset: params.target_asset,
          target_amount: params.source_amount - 1,
          steps: [],
          estimated_fee: name === 'lifi' ? 0.5 : 0.3,
          estimated_time: name === 'lifi' ? 30 : 25,
          security_score: 85,
          reliability_score: 90,
          expires_at: new Date(Date.now() + 60000),
          ...quoteResult,
        })),
    execute: vi.fn(async (): Promise<RouteExecutionResult> => ({
      execution_id: `exec-${name}`,
      status: 'COMPLETED',
      transaction_hashes: ['0xabc'],
      actual_fee: 0.5,
      actual_time: 25,
    })),
    getStatus: vi.fn(async () => 'COMPLETED' as const),
    circuitBreaker: cb,
    isHealthy: () => cb.getState() !== 'OPEN',
    getCircuitState: () => cb.getState(),
  } as IRouteProvider & { circuitBreaker: CircuitBreaker; isHealthy: () => boolean };

  return provider;
}

// ─── Test Data ───────────────────────────────────────────────────────────

const defaultParams: RouteQuoteParams = {
  source_chain: 'ethereum',
  source_asset: 'USDC',
  source_amount: 1000,
  target_chain: 'base',
  target_asset: 'USDC',
  target_amount: 1000,
};

// ─── Tests ───────────────────────────────────────────────────────────────

describe('RouteEngine', () => {
  let registry: ProviderRegistry;
  let engine: RouteEngine;

  beforeEach(() => {
    registry = new ProviderRegistry();
    engine = new RouteEngine(registry);
  });

  // ─── selectBestRoute ─────────────────────────────────────────────────

  describe('selectBestRoute', () => {
    it('throws NoValidQuotesError if no providers registered', async () => {
      await expect(engine.selectBestRoute(defaultParams)).rejects.toThrow(NoValidQuotesError);
    });

    it('throws NoValidQuotesError if no providers support the chains', async () => {
      registry.register(createMockProvider('lifi', ['polygon']));
      await expect(engine.selectBestRoute(defaultParams)).rejects.toThrow(NoValidQuotesError);
    });

    it('selects the best route from multiple providers', async () => {
      registry.register(createMockProvider('lifi', ['ethereum', 'base'], { estimated_fee: 1.0 }));
      registry.register(createMockProvider('socket', ['ethereum', 'base'], { estimated_fee: 0.2 }));

      const result = await engine.selectBestRoute(defaultParams);

      expect(result).toHaveProperty('quote');
      expect(result).toHaveProperty('score');
      // Socket has lower fee, should be selected
      expect(result.quote.provider).toBe('socket');
    });

    it('handles provider failure gracefully', async () => {
      const failingProvider = createMockProvider(
        'failing',
        ['ethereum', 'base'],
        undefined,
        async () => { throw new Error('API down'); },
      );
      const workingProvider = createMockProvider('lifi', ['ethereum', 'base'], { estimated_fee: 0.5 });

      registry.register(failingProvider);
      registry.register(workingProvider);

      const result = await engine.selectBestRoute(defaultParams);
      expect(result.quote.provider).toBe('lifi');
    });

    it('throws if all providers fail', async () => {
      const failing = createMockProvider(
        'failing',
        ['ethereum', 'base'],
        undefined,
        async () => { throw new Error('API down'); },
      );
      registry.register(failing);

      await expect(engine.selectBestRoute(defaultParams)).rejects.toThrow();
    });

    it('filters out expired quotes', async () => {
      registry.register(createMockProvider(
        'expired',
        ['ethereum', 'base'],
        { expires_at: new Date(Date.now() - 1000) },
      ));
      registry.register(createMockProvider(
        'valid',
        ['ethereum', 'base'],
        { expires_at: new Date(Date.now() + 60000), estimated_fee: 0.5 },
      ));

      const result = await engine.selectBestRoute(defaultParams);
      expect(result.quote.provider).toBe('valid');
    });

    it('skips unhealthy providers when configured', async () => {
      const unhealthy = createMockProvider('unhealthy', ['ethereum', 'base']);
      for (let i = 0; i < 5; i++) {
        await unhealthy.circuitBreaker.execute(async () => { throw new Error('fail'); }).catch(() => {});
      }

      const healthy = createMockProvider('healthy', ['ethereum', 'base'], { estimated_fee: 0.5 });

      registry.register(unhealthy);
      registry.register(healthy);

      const engineWithSkip = new RouteEngine(registry, undefined, { skipOpenCircuits: true });
      const result = await engineWithSkip.selectBestRoute(defaultParams);
      expect(result.quote.provider).toBe('healthy');
    });
  });

  // ─── executeRoute ────────────────────────────────────────────────────

  describe('executeRoute', () => {
    it('executes route through the correct provider', async () => {
      const provider = createMockProvider('lifi', ['ethereum', 'base']);
      registry.register(provider);

      const quote: RouteQuote = {
        id: 'test-quote',
        provider: 'lifi',
        source_chain: 'ethereum',
        source_asset: 'USDC',
        source_amount: 1000,
        target_chain: 'base',
        target_asset: 'USDC',
        target_amount: 999,
        steps: [],
        estimated_fee: 1,
        estimated_time: 30,
        security_score: 85,
        reliability_score: 90,
        expires_at: new Date(Date.now() + 60000),
      };

      const result = await engine.executeRoute(quote);
      expect(result.status).toBe('COMPLETED');
      expect(result.transaction_hashes).toBeDefined();
    });

    it('throws ProviderUnavailableError for unknown provider', async () => {
      const quote: RouteQuote = {
        id: 'test-quote',
        provider: 'nonexistent',
        source_chain: 'ethereum',
        source_asset: 'USDC',
        source_amount: 1000,
        target_chain: 'base',
        target_asset: 'USDC',
        target_amount: 999,
        steps: [],
        estimated_fee: 1,
        estimated_time: 30,
        security_score: 85,
        reliability_score: 90,
        expires_at: new Date(Date.now() + 60000),
      };

      await expect(engine.executeRoute(quote)).rejects.toThrow(ProviderUnavailableError);
    });
  });

  // ─── getAllRoutes ────────────────────────────────────────────────────

  describe('getAllRoutes', () => {
    it('returns all ranked routes', async () => {
      registry.register(createMockProvider('lifi', ['ethereum', 'base'], { estimated_fee: 1.0 }));
      registry.register(createMockProvider('socket', ['ethereum', 'base'], { estimated_fee: 0.3 }));

      const routes = await engine.getAllRoutes(defaultParams);
      expect(routes).toHaveLength(2);
      // Should be sorted by score (socket first due to lower fee)
      expect(routes[0]!.quote.provider).toBe('socket');
      expect(routes[1]!.quote.provider).toBe('lifi');
    });

    it('returns empty array if no providers', async () => {
      const routes = await engine.getAllRoutes(defaultParams);
      expect(routes).toEqual([]);
    });
  });

  // ─── Accessors ───────────────────────────────────────────────────────

  describe('accessors', () => {
    it('getScorer returns the scorer', () => {
      expect(engine.getScorer()).toBeDefined();
    });

    it('getRegistry returns the registry', () => {
      expect(engine.getRegistry()).toBe(registry);
    });
  });

  // ─── Custom Config ──────────────────────────────────────────────────

  describe('custom config', () => {
    it('respects custom quote timeout', async () => {
      const slowProvider = createMockProvider(
        'slow',
        ['ethereum', 'base'],
        undefined,
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 10000));
          return {} as RouteQuote;
        },
      );
      registry.register(slowProvider);

      const fastEngine = new RouteEngine(registry, undefined, { quoteTimeoutMs: 100 });

      await expect(fastEngine.selectBestRoute(defaultParams)).rejects.toThrow();
    });

    it('respects custom merchant preferences', async () => {
      registry.register(createMockProvider('lifi', ['ethereum', 'base'], { estimated_fee: 5.0 }));
      registry.register(createMockProvider('socket', ['ethereum', 'base'], { estimated_fee: 0.1 }));

      const prefs: Partial<MerchantPreferences> = { fee_weight: 0.9, time_weight: 0.05, security_weight: 0.025, reliability_weight: 0.025 };
      const feeEngine = new RouteEngine(registry, prefs);

      const result = await feeEngine.selectBestRoute(defaultParams);
      expect(result.quote.provider).toBe('socket');
    });
  });
});
