/**
 * Provider Registry
 *
 * Manages registered route providers and provides lookup methods
 * for finding providers that support specific chain/asset pairs.
 */

import type { IRouteProvider } from '@crypto-gateway/shared';

export class ProviderRegistry {
  private readonly providers = new Map<string, IRouteProvider>();

  /**
   * Register a provider.
   */
  register(provider: IRouteProvider): void {
    const name = provider.getName();
    if (this.providers.has(name)) {
      throw new Error(`Provider already registered: ${name}`);
    }
    this.providers.set(name, provider);
  }

  /**
   * Unregister a provider.
   */
  unregister(name: string): boolean {
    return this.providers.delete(name);
  }

  /**
   * Get a provider by name.
   */
  get(name: string): IRouteProvider | undefined {
    return this.providers.get(name);
  }

  /**
   * Get all registered providers.
   */
  getAll(): IRouteProvider[] {
    return Array.from(this.providers.values());
  }

  /**
   * Get provider names.
   */
  getNames(): string[] {
    return Array.from(this.providers.keys());
  }

  /**
   * Get providers that support both source and target chains.
   */
  getSupportedProviders(sourceChain: string, targetChain: string): IRouteProvider[] {
    return this.getAll().filter((provider) => {
      const chains = provider.getSupportedChains();
      return chains.includes(sourceChain) && chains.includes(targetChain);
    });
  }

  /**
   * Get providers that support a specific chain.
   */
  getProvidersForChain(chain: string): IRouteProvider[] {
    return this.getAll().filter((provider) =>
      provider.getSupportedChains().includes(chain),
    );
  }

  /**
   * Get the number of registered providers.
   */
  size(): number {
    return this.providers.size;
  }

  /**
   * Check if a provider is registered.
   */
  has(name: string): boolean {
    return this.providers.has(name);
  }

  /**
   * Clear all providers.
   */
  clear(): void {
    this.providers.clear();
  }
}
