/**
 * Chain Registry
 * Central registry for all chain clients. Provides lookup by chain ID, name, or enumeration.
 */

import type { IChainClient } from '@crypto-gateway/shared';
import { UnsupportedChainError } from '@crypto-gateway/shared';

export class ChainRegistry {
  private readonly clients: Map<string, IChainClient> = new Map();
  private readonly nameIndex: Map<string, string> = new Map(); // lowercase name → chainId

  /**
   * Register a chain client.
   * @throws if a client with the same chainId is already registered.
   */
  register(client: IChainClient): void {
    const { chainId, chainName } = client;

    if (this.clients.has(chainId)) {
      throw new Error(`Chain client already registered for chainId: ${chainId}`);
    }

    this.clients.set(chainId, client);
    this.nameIndex.set(chainName.toLowerCase(), chainId);
  }

  /**
   * Get a chain client by chain ID.
   * @throws UnsupportedChainError if chain is not registered.
   */
  get(chainId: string): IChainClient {
    const client = this.clients.get(chainId);
    if (!client) {
      throw new UnsupportedChainError(chainId);
    }
    return client;
  }

  /**
   * Get a chain client by chain name (case-insensitive).
   * @returns undefined if not found.
   */
  getByName(name: string): IChainClient | undefined {
    const chainId = this.nameIndex.get(name.toLowerCase());
    if (!chainId) return undefined;
    return this.clients.get(chainId);
  }

  /**
   * Try to get a chain client, returning undefined instead of throwing.
   */
  tryGet(chainId: string): IChainClient | undefined {
    return this.clients.get(chainId);
  }

  /**
   * Get all registered chain clients.
   */
  getAll(): IChainClient[] {
    return Array.from(this.clients.values());
  }

  /**
   * Get all supported chain IDs.
   */
  getSupportedChainIds(): string[] {
    return Array.from(this.clients.keys());
  }

  /**
   * Get all supported chain names.
   */
  getSupportedChainNames(): string[] {
    return Array.from(this.nameIndex.keys());
  }

  /**
   * Check if a chain is supported.
   */
  isSupported(chainId: string): boolean {
    return this.clients.has(chainId);
  }

  /**
   * Unregister a chain client.
   */
  unregister(chainId: string): boolean {
    const client = this.clients.get(chainId);
    if (!client) return false;

    this.clients.delete(chainId);
    this.nameIndex.delete(client.chainName.toLowerCase());
    return true;
  }

  /**
   * Get count of registered chains.
   */
  size(): number {
    return this.clients.size;
  }
}
