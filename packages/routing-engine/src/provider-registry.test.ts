import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProviderRegistry } from './provider-registry.js';
import type { IRouteProvider, RouteQuote, RouteExecutionResult } from '@crypto-gateway/shared';

// ─── Mock Provider ──────────────────────────────────────────────────────

function createMockProvider(
  name: string,
  chains: string[],
  assets: string[] = ['USDC', 'USDT', 'ETH'],
): IRouteProvider {
  return {
    getName: () => name,
    getSupportedChains: () => chains,
    getSupportedAssets: (_chain: string) => assets,
    quote: vi.fn(async (): Promise<RouteQuote> => ({
      id: `quote-${name}`,
      provider: name,
      source_chain: 'ethereum',
      source_asset: 'USDC',
      source_amount: 100,
      target_chain: 'base',
      target_asset: 'USDC',
      target_amount: 99,
      steps: [],
      estimated_fee: 1,
      estimated_time: 30,
      security_score: 80,
      reliability_score: 85,
      expires_at: new Date(Date.now() + 60000),
    })),
    execute: vi.fn(async (): Promise<RouteExecutionResult> => ({
      execution_id: `exec-${name}`,
      status: 'COMPLETED',
      transaction_hashes: ['0xabc'],
      actual_fee: 1,
      actual_time: 25,
    })),
    getStatus: vi.fn(async () => 'COMPLETED' as const),
  } as IRouteProvider;
}

// ─── Tests ───────────────────────────────────────────────────────────────

describe('ProviderRegistry', () => {
  let registry: ProviderRegistry;

  beforeEach(() => {
    registry = new ProviderRegistry();
  });

  // ─── Register / Unregister ───────────────────────────────────────────

  describe('register', () => {
    it('registers a provider', () => {
      const provider = createMockProvider('lifi', ['ethereum', 'base']);
      registry.register(provider);

      expect(registry.has('lifi')).toBe(true);
      expect(registry.size()).toBe(1);
    });

    it('throws if provider already registered', () => {
      const provider = createMockProvider('lifi', ['ethereum']);
      registry.register(provider);

      expect(() => registry.register(provider)).toThrow('Provider already registered: lifi');
    });
  });

  describe('unregister', () => {
    it('removes a provider', () => {
      const provider = createMockProvider('lifi', ['ethereum']);
      registry.register(provider);

      const removed = registry.unregister('lifi');
      expect(removed).toBe(true);
      expect(registry.has('lifi')).toBe(false);
      expect(registry.size()).toBe(0);
    });

    it('returns false if provider not found', () => {
      expect(registry.unregister('nonexistent')).toBe(false);
    });
  });

  // ─── Getters ─────────────────────────────────────────────────────────

  describe('get', () => {
    it('returns provider by name', () => {
      const provider = createMockProvider('lifi', ['ethereum']);
      registry.register(provider);

      expect(registry.get('lifi')).toBe(provider);
    });

    it('returns undefined for unknown provider', () => {
      expect(registry.get('nonexistent')).toBeUndefined();
    });
  });

  describe('getAll', () => {
    it('returns all registered providers', () => {
      const lifi = createMockProvider('lifi', ['ethereum']);
      const socket = createMockProvider('socket', ['base']);
      registry.register(lifi);
      registry.register(socket);

      const all = registry.getAll();
      expect(all).toHaveLength(2);
      expect(all).toContain(lifi);
      expect(all).toContain(socket);
    });

    it('returns empty array when no providers', () => {
      expect(registry.getAll()).toEqual([]);
    });
  });

  describe('getNames', () => {
    it('returns all provider names', () => {
      registry.register(createMockProvider('lifi', ['ethereum']));
      registry.register(createMockProvider('socket', ['base']));

      expect(registry.getNames()).toEqual(['lifi', 'socket']);
    });
  });

  // ─── Chain-based Lookup ──────────────────────────────────────────────

  describe('getSupportedProviders', () => {
    it('returns providers supporting both source and target chains', () => {
      registry.register(createMockProvider('lifi', ['ethereum', 'base']));
      registry.register(createMockProvider('socket', ['ethereum', 'polygon']));
      registry.register(createMockProvider('hop', ['base', 'polygon']));

      const supported = registry.getSupportedProviders('ethereum', 'base');
      expect(supported).toHaveLength(1);
      expect(supported[0]!.getName()).toBe('lifi');
    });

    it('returns empty array if no provider supports both chains', () => {
      registry.register(createMockProvider('lifi', ['ethereum']));
      registry.register(createMockProvider('socket', ['polygon']));

      const supported = registry.getSupportedProviders('ethereum', 'polygon');
      expect(supported).toHaveLength(0);
    });

    it('returns empty array if registry is empty', () => {
      const supported = registry.getSupportedProviders('ethereum', 'base');
      expect(supported).toHaveLength(0);
    });
  });

  describe('getProvidersForChain', () => {
    it('returns providers supporting a specific chain', () => {
      registry.register(createMockProvider('lifi', ['ethereum', 'base']));
      registry.register(createMockProvider('socket', ['polygon']));
      registry.register(createMockProvider('hop', ['ethereum', 'polygon']));

      const providers = registry.getProvidersForChain('ethereum');
      expect(providers).toHaveLength(2);
      expect(providers.map((p) => p.getName())).toContain('lifi');
      expect(providers.map((p) => p.getName())).toContain('hop');
    });

    it('returns empty array if no provider supports the chain', () => {
      registry.register(createMockProvider('lifi', ['ethereum']));
      const providers = registry.getProvidersForChain('avalanche');
      expect(providers).toHaveLength(0);
    });
  });

  // ─── Misc ────────────────────────────────────────────────────────────

  describe('clear', () => {
    it('removes all providers', () => {
      registry.register(createMockProvider('lifi', ['ethereum']));
      registry.register(createMockProvider('socket', ['base']));

      registry.clear();

      expect(registry.size()).toBe(0);
      expect(registry.getAll()).toEqual([]);
    });
  });

  describe('size', () => {
    it('tracks provider count', () => {
      expect(registry.size()).toBe(0);

      registry.register(createMockProvider('lifi', ['ethereum']));
      expect(registry.size()).toBe(1);

      registry.register(createMockProvider('socket', ['base']));
      expect(registry.size()).toBe(2);

      registry.unregister('lifi');
      expect(registry.size()).toBe(1);
    });
  });
});
