import { describe, it, expect, beforeEach } from 'vitest';
import { MockLiFiProvider } from './mock-lifi-provider.js';
import type { RouteQuoteParams } from '@crypto-gateway/shared';

const defaultParams: RouteQuoteParams = {
  source_chain: 'ethereum',
  source_asset: 'USDC',
  source_amount: 1000,
  target_chain: 'base',
  target_asset: 'USDC',
  target_amount: 1000,
};

describe('MockLiFiProvider', () => {
  let provider: MockLiFiProvider;

  beforeEach(() => {
    provider = new MockLiFiProvider();
  });

  describe('basic properties', () => {
    it('returns correct name', () => {
      expect(provider.getName()).toBe('lifi');
    });

    it('returns supported chains', () => {
      const chains = provider.getSupportedChains();
      expect(chains).toContain('ethereum');
      expect(chains).toContain('base');
      expect(chains).toContain('polygon');
      expect(chains).toContain('arbitrum');
    });

    it('returns supported assets for any chain', () => {
      const assets = provider.getSupportedAssets('ethereum');
      expect(assets).toContain('USDC');
      expect(assets).toContain('USDT');
      expect(assets).toContain('ETH');
    });
  });

  describe('quote', () => {
    it('returns a valid RouteQuote', async () => {
      const quote = await provider.quote(defaultParams);

      expect(quote).toHaveProperty('id');
      expect(quote.provider).toBe('lifi');
      expect(quote.source_chain).toBe('ethereum');
      expect(quote.target_chain).toBe('base');
      expect(quote.estimated_fee).toBeGreaterThan(0);
      expect(quote.estimated_time).toBeGreaterThan(0);
      expect(quote.expires_at.getTime()).toBeGreaterThan(Date.now());
    });

    it('returns higher fee for cross-chain routes', async () => {
      const crossChain = await provider.quote({
        source_chain: 'ethereum',
        source_asset: 'USDC',
        source_amount: 1000,
        target_chain: 'polygon',
        target_asset: 'USDC',
        target_amount: 1000,
      });

      const sameChain = await provider.quote({
        source_chain: 'ethereum',
        source_asset: 'USDC',
        source_amount: 1000,
        target_chain: 'ethereum',
        target_asset: 'USDC',
        target_amount: 1000,
      });

      expect(crossChain.estimated_fee).toBeGreaterThan(sameChain.estimated_fee);
    });

    it('returns steps array', async () => {
      const quote = await provider.quote(defaultParams);
      expect(quote.steps).toBeDefined();
      expect(quote.steps.length).toBeGreaterThan(0);
    });
  });

  describe('execute', () => {
    it('returns a valid execution result', async () => {
      const quote = await provider.quote(defaultParams);
      const result = await provider.execute(quote);

      expect(result.execution_id).toBeDefined();
      expect(result.status).toBe('COMPLETED');
      expect(result.transaction_hashes).toBeDefined();
      expect(result.transaction_hashes.length).toBeGreaterThan(0);
    });
  });

  describe('getStatus', () => {
    it('returns COMPLETED status', async () => {
      const status = await provider.getStatus('any-id');
      expect(status).toBe('COMPLETED');
    });
  });

  describe('failure simulation', () => {
    it('throws when failureRate is 1', async () => {
      const failingProvider = new MockLiFiProvider({ failureRate: 1 });

      await expect(failingProvider.quote(defaultParams)).rejects.toThrow();
    });

    it('works normally when failureRate is 0', async () => {
      const reliableProvider = new MockLiFiProvider({ failureRate: 0 });

      // Run multiple times to ensure no random failures
      for (let i = 0; i < 10; i++) {
        const quote = await reliableProvider.quote(defaultParams);
        expect(quote.estimated_fee).toBeGreaterThan(0);
      }
    });
  });

  describe('circuit breaker integration', () => {
    it('isHealthy returns true by default', () => {
      expect(provider.isHealthy()).toBe(true);
    });

    it('getCircuitState returns CLOSED by default', () => {
      expect(provider.getCircuitState()).toBe('CLOSED');
    });

    it('resetCircuit resets circuit breaker', async () => {
      // Trigger failures to open circuit
      const failingProvider = new MockLiFiProvider({ failureRate: 1 });
      for (let i = 0; i < 5; i++) {
        try { await failingProvider.quote(defaultParams); } catch {}
      }

      expect(failingProvider.getCircuitState()).toBe('OPEN');

      failingProvider.resetCircuit();
      expect(failingProvider.getCircuitState()).toBe('CLOSED');
    });
  });
});
