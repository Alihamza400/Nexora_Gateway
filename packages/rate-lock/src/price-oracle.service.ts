/**
 * Price Oracle Service
 * Fetches and caches cryptocurrency prices from multiple sources.
 * Supports CoinGecko (free) and Chainlink (on-chain) adapters.
 */

import type { IPriceOracle, PriceQuote } from '@crypto-gateway/shared';

// ─── CoinGecko Adapter ───────────────────────────────────────────────────────

export class CoinGeckoOracle implements IPriceOracle {
  private readonly baseUrl = 'https://api.coingecko.com/api/v3';
  private readonly cache = new Map<string, { quote: PriceQuote; expiresAt: number }>();
  private readonly cacheTtlMs: number;

  constructor(
    private readonly apiKey?: string,
    cacheTtlSeconds: number = 30,
  ) {
    this.cacheTtlMs = cacheTtlSeconds * 1000;
  }

  getName(): string {
    return 'coingecko';
  }

  async getPrice(asset: string, baseAsset: string = 'usd'): Promise<PriceQuote> {
    const cacheKey = `${asset.toLowerCase()}:${baseAsset.toLowerCase()}`;
    const cached = this.cache.get(cacheKey);

    if (cached && cached.expiresAt > Date.now()) {
      return cached.quote;
    }

    const vsCurrency = baseAsset.toLowerCase();
    const coinId = this.getCoinGeckoId(asset) ?? asset.toLowerCase();

    const headers: Record<string, string> = {
      Accept: 'application/json',
    };

    if (this.apiKey) {
      headers['x-cg-demo-api-key'] = this.apiKey;
    }

    const response = await fetch(
      `${this.baseUrl}/simple/price?ids=${coinId}&vs_currencies=${vsCurrency}&include_last_updated_at=true`,
      { headers },
    );

    if (!response.ok) {
      throw new Error(`CoinGecko API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as Record<
      string,
      Record<string, number> & { last_updated_at?: number }
    >;
    const priceData = data[coinId] as
      (Record<string, number> & { last_updated_at?: number }) | undefined;

    if (!priceData || priceData[vsCurrency] === undefined) {
      throw new Error(`No price data for ${asset} on CoinGecko`);
    }

    const price = priceData[vsCurrency];
    const lastUpdated = priceData.last_updated_at
      ? new Date(priceData.last_updated_at * 1000)
      : new Date();

    const quote: PriceQuote = {
      asset: asset.toUpperCase(),
      baseAsset: baseAsset.toUpperCase(),
      price,
      timestamp: lastUpdated,
      source: 'coingecko',
      confidence: 0.95, // CoinGecko is generally reliable
    };

    // Cache the result
    this.cache.set(cacheKey, {
      quote,
      expiresAt: Date.now() + this.cacheTtlMs,
    });

    return quote;
  }

  async getPrices(assets: string[], baseAsset: string = 'usd'): Promise<PriceQuote[]> {
    const coinIds = assets.map((a) => this.getCoinGeckoId(a)).join(',');
    const vsCurrency = baseAsset.toLowerCase();

    const headers: Record<string, string> = {
      Accept: 'application/json',
    };

    if (this.apiKey) {
      headers['x-cg-demo-api-key'] = this.apiKey;
    }

    const response = await fetch(
      `${this.baseUrl}/simple/price?ids=${coinIds}&vs_currencies=${vsCurrency}&include_last_updated_at=true`,
      { headers },
    );

    if (!response.ok) {
      throw new Error(`CoinGecko API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as Record<
      string,
      Record<string, number> & { last_updated_at?: number }
    >;

    return assets.map((asset, index) => {
      const coinIdParts = coinIds.split(',');
      const coinId = coinIdParts[index] ?? asset.toLowerCase();
      const priceData = data[coinId];

      if (!priceData || priceData[vsCurrency] === undefined) {
        return {
          asset: asset.toUpperCase(),
          baseAsset: baseAsset.toUpperCase(),
          price: 0,
          timestamp: new Date(),
          source: 'coingecko',
          confidence: 0,
        };
      }

      return {
        asset: asset.toUpperCase(),
        baseAsset: baseAsset.toUpperCase(),
        price: priceData[vsCurrency],
        timestamp: priceData.last_updated_at
          ? new Date(priceData.last_updated_at * 1000)
          : new Date(),
        source: 'coingecko',
        confidence: 0.95,
      };
    });
  }

  async isHealthy(): Promise<boolean> {
    try {
      await this.getPrice('bitcoin', 'usd');
      return true;
    } catch {
      return false;
    }
  }

  private getCoinGeckoId(asset: string): string {
    const mapping: Record<string, string> = {
      BTC: 'bitcoin',
      ETH: 'ethereum',
      USDT: 'tether',
      USDC: 'usd-coin',
      DAI: 'dai',
      SOL: 'solana',
      MATIC: 'matic-network',
      POL: 'matic-network',
      ARB: 'arbitrum',
      OP: 'optimism',
      TRX: 'tron',
      DOGE: 'dogecoin',
      SHIB: 'shiba-inu',
      PEPE: 'pepe',
      AVAX: 'avalanche-2',
      BNB: 'binancecoin',
      XRP: 'ripple',
      ADA: 'cardano',
      DOT: 'polkadot',
      LINK: 'chainlink',
      UNI: 'uniswap',
      AAVE: 'aave',
    };

    const upper = asset.toUpperCase();
    return mapping[upper] ?? asset.toLowerCase();
  }
}

// ─── Chainlink Oracle (On-Chain) ─────────────────────────────────────────────

/**
 * Chainlink Price Feed ABI (latestRoundData).
 * We only need the specific function, not the full ABI.
 */
const CHAINLINK_FEED_ABI = [
  'function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)',
  'function decimals() view returns (uint8)',
  'function description() view returns (string)',
];

/**
 * Chainlink price feed addresses per asset/chain.
 * Format: asset → chainId → feed address
 */
const CHAINLINK_FEEDS: Record<string, Record<number, string>> = {
  ETH: {
    1: '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419', // ETH/USD
    137: '0xAB594600376Ec9fD91A8929489aB60d37370871', // ETH/USD on Polygon
    42161: '0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612', // ETH/USD on Arbitrum
    10: '0x13e3Ee699D190924892C76d03aB7596CaE20c1E', // ETH/USD on Optimism
    8453: '0x71041dddad3595F9CED3DcCFBe3D1C4b13259712', // ETH/USD on Base
  },
  BTC: {
    1: '0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c', // BTC/USD
    137: '0xc907E116054Ad103354f2D350FD2514433D57F6f', // BTC/USD on Polygon
    42161: '0x6ce18b86e1e04cdab7098fa86a5f4a7fbaa7417a', // BTC/USD on Arbitrum
  },
  LINK: {
    1: '0x2c1d072e956AFFC0D435Cb7AC38EF18d24d9127c', // LINK/USD
    137: '0xd9FFdb71760576bdc02F71a19eB4f0bD7D0EAD37', // LINK/USD on Polygon
  },
  USDC: {
    1: '0x8fFfF89722A27f4d180eBe9089f8a98c5cA7f06c', // USDC/USD
  },
  USDT: {
    1: '0x3E7e18F96831Be8527d974F8a1c98E442c8BF72a', // USDT/USD
  },
  MATIC: {
    1: '0x56e537a6C316c66887a5408F301a375808F8156e', // MATIC/USD on Ethereum
    137: '0x0d78787C368Da3a736eaC3CE5426B0326271a87e', // MATIC/USD on Polygon
  },
  ARB: {
    42161: '0x5402B5F40310bDED796c7D0F3FF6683f5C4cF2F9', // ARB/USD on Arbitrum
  },
  OP: {
    10: '0x099a2476cC49bA519D227E8f7626a48390C8a32E', // OP/USD on Optimism
  },
  SOL: {
    // Solana doesn't have EVM Chainlink feeds; use Pyth or Switchboard
    // For EVM-compatible access, use bridged SOL price on Ethereum
    1: '0x4ffC43a60e009B551865A93d232E33Fce9f01507', // SOL/USD on Ethereum
  },
};

export class ChainlinkOracle implements IPriceOracle {
  private readonly cache = new Map<string, { quote: PriceQuote; expiresAt: number }>();
  private readonly cacheTtlMs: number;
  private readonly rpcUrl: string;
  private provider: unknown = null;

  constructor(rpcUrl: string, cacheTtlSeconds: number = 60) {
    this.rpcUrl = rpcUrl;
    this.cacheTtlMs = cacheTtlSeconds * 1000;
  }

  getName(): string {
    return 'chainlink';
  }

  async getPrice(asset: string, baseAsset: string = 'usd'): Promise<PriceQuote> {
    const cacheKey = `${asset.toLowerCase()}:${baseAsset.toLowerCase()}`;
    const cached = this.cache.get(cacheKey);

    if (cached && cached.expiresAt > Date.now()) {
      return cached.quote;
    }

    // Only support USD as base asset for Chainlink
    if (baseAsset.toLowerCase() !== 'usd') {
      throw new Error(`Chainlink oracle only supports USD as base asset, got ${baseAsset}`);
    }

    // Get the provider (lazy initialization)
    const provider = await this.getProvider();

    // Find the feed address
    const upperAsset = asset.toUpperCase();
    const feeds = CHAINLINK_FEEDS[upperAsset];
    if (!feeds) {
      throw new Error(`No Chainlink feed configured for ${asset}/USD`);
    }

    // Try Ethereum mainnet first, then other chains
    const chainIds = [1, 137, 42161, 10, 8453];
    let lastError: Error | null = null;

    for (const chainId of chainIds) {
      const feedAddress = feeds[chainId];
      if (!feedAddress) continue;

      try {
        const quote = await this.fetchFromFeed(provider, feedAddress, upperAsset, cacheKey);
        return quote;
      } catch (error) {
        lastError = error as Error;
        continue;
      }
    }

    throw lastError ?? new Error(`Failed to fetch ${asset}/USD from any Chainlink feed`);
  }

  async getPrices(assets: string[], baseAsset: string = 'usd'): Promise<PriceQuote[]> {
    const results: PriceQuote[] = [];

    for (const asset of assets) {
      try {
        const quote = await this.getPrice(asset, baseAsset);
        results.push(quote);
      } catch {
        results.push({
          asset: asset.toUpperCase(),
          baseAsset: baseAsset.toUpperCase(),
          price: 0,
          timestamp: new Date(),
          source: 'chainlink',
          confidence: 0,
        });
      }
    }

    return results;
  }

  async isHealthy(): Promise<boolean> {
    try {
      await this.getPrice('ETH', 'usd');
      return true;
    } catch {
      return false;
    }
  }

  // ─── Private Methods ──────────────────────────────────────────────────

  private async getProvider(): Promise<unknown> {
    if (this.provider) {
      return this.provider;
    }

    // Dynamic import of ethers to avoid hard dependency
    try {
      const { JsonRpcProvider, Interface } = await import('ethers');
      const provider = new JsonRpcProvider(this.rpcUrl);
      this.provider = { provider, Interface };
      return this.provider;
    } catch {
      throw new Error(
        'ethers.js is required for Chainlink oracle. Install with: npm install ethers',
      );
    }
  }

  private async fetchFromFeed(
    providerState: unknown,
    feedAddress: string,
    asset: string,
    cacheKey: string,
  ): Promise<PriceQuote> {
    const { provider, Interface } = providerState as {
      provider: { call: (tx: { to: string; data: string }) => Promise<string> };
      Interface: new (abi: string[]) => {
        encodeFunctionData: (fn: string) => string;
        decodeFunctionResult: (fn: string, data: string) => unknown[];
      };
    };

    const iface = new Interface(CHAINLINK_FEED_ABI);

    // Get decimals
    const decimalsData = iface.encodeFunctionData('decimals');
    const decimalsResult = await provider.call({
      to: feedAddress,
      data: decimalsData,
    });
    const decodedDecimals = iface.decodeFunctionResult('decimals', decimalsResult);
    const decimals = Number(decodedDecimals[0]);

    // Get latest round data
    const roundData = iface.encodeFunctionData('latestRoundData');
    const result = await provider.call({
      to: feedAddress,
      data: roundData,
    });

    const decoded = iface.decodeFunctionResult('latestRoundData', result);
    const answer = decoded[1] as bigint;
    const updatedAt = decoded[3] as bigint;

    // Convert to price
    const price = Number(answer) / Math.pow(10, decimals);
    const timestamp = new Date(Number(updatedAt) * 1000);

    // Validate staleness (reject if older than 1 hour)
    const maxAgeMs = 60 * 60 * 1000;
    if (Date.now() - timestamp.getTime() > maxAgeMs) {
      throw new Error(
        `Chainlink price for ${asset} is stale (updated at ${timestamp.toISOString()})`,
      );
    }

    // Validate price is positive
    if (price <= 0) {
      throw new Error(`Chainlink returned invalid price for ${asset}: ${price}`);
    }

    const quote: PriceQuote = {
      asset,
      baseAsset: 'USD',
      price,
      timestamp,
      source: 'chainlink',
      confidence: 0.98, // Chainlink is highly reliable when available
    };

    // Cache the result
    this.cache.set(cacheKey, {
      quote,
      expiresAt: Date.now() + this.cacheTtlMs,
    });

    return quote;
  }
}

// ─── Price Oracle Aggregator ─────────────────────────────────────────────────

export class PriceOracleAggregator implements IPriceOracle {
  private readonly oracles: IPriceOracle[];
  private readonly minConfidence: number;

  constructor(oracles: IPriceOracle[], minConfidence: number = 0.8) {
    this.oracles = oracles;
    this.minConfidence = minConfidence;
  }

  getName(): string {
    return `aggregator(${this.oracles.map((o) => o.getName()).join('+')})`;
  }

  async getPrice(asset: string, baseAsset: string = 'usd'): Promise<PriceQuote> {
    const results = await Promise.allSettled(
      this.oracles.map((oracle) => oracle.getPrice(asset, baseAsset)),
    );

    const successful = results
      .filter((r): r is PromiseFulfilledResult<PriceQuote> => r.status === 'fulfilled')
      .map((r) => r.value)
      .filter((q) => q.confidence >= this.minConfidence && q.price > 0);

    if (successful.length === 0) {
      throw new Error(`No oracle returned a valid price for ${asset}/${baseAsset}`);
    }

    // Use median price from successful oracles
    const prices = successful.map((q) => q.price).sort((a, b) => a - b);
    const medianIndex = Math.floor(prices.length / 2);
    const medianPrice = prices[medianIndex] ?? prices[0] ?? 0;

    return {
      asset: asset.toUpperCase(),
      baseAsset: baseAsset.toUpperCase(),
      price: medianPrice,
      timestamp: new Date(),
      source: this.getName(),
      confidence: this.calculateConfidence(successful),
    };
  }

  async getPrices(assets: string[], baseAsset: string = 'usd'): Promise<PriceQuote[]> {
    return Promise.all(assets.map((asset) => this.getPrice(asset, baseAsset)));
  }

  async isHealthy(): Promise<boolean> {
    const results = await Promise.allSettled(this.oracles.map((oracle) => oracle.isHealthy()));
    return results.some((r) => r.status === 'fulfilled' && r.value);
  }

  private calculateConfidence(quotes: PriceQuote[]): number {
    if (quotes.length === 1) return quotes[0]?.confidence ?? 0;

    // Calculate price variance
    const prices = quotes.map((q) => q.price);
    const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
    const variance = prices.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / prices.length;
    const stdDev = Math.sqrt(variance);
    const coefficientOfVariation = stdDev / mean;

    // Lower variance = higher confidence
    const confidence = Math.max(0, 1 - coefficientOfVariation * 10);
    return Math.min(confidence, 1);
  }
}
