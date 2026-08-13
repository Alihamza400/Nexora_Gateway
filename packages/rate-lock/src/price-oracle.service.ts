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

    const data = await response.json() as Record<string, Record<string, number> & { last_updated_at?: number }>;
    const priceData = data[coinId] as Record<string, number> & { last_updated_at?: number } | undefined;

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

    const data = await response.json() as Record<string, Record<string, number> & { last_updated_at?: number }>;

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

export class ChainlinkOracle implements IPriceOracle {
  private readonly cache = new Map<string, { quote: PriceQuote; expiresAt: number }>();

  constructor(
    _rpcUrl: string,
    _cacheTtlSeconds: number = 60,
  ) {}

  getName(): string {
    return 'chainlink';
  }

  getPrice(asset: string, baseAsset: string = 'usd'): Promise<PriceQuote> {
    const cacheKey = `${asset.toLowerCase()}:${baseAsset.toLowerCase()}`;
    const cached = this.cache.get(cacheKey);

    if (cached && cached.expiresAt > Date.now()) {
      return Promise.resolve(cached.quote);
    }

    // In production, this would call the Chainlink price feed contract
    // For now, return a placeholder that indicates the feed is not configured
    return Promise.reject(
      new Error(
        `Chainlink feed not configured for ${asset}/${baseAsset}. ` +
        `Configure the feed address in chain config.`,
      ),
    );
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

  isHealthy(): Promise<boolean> {
    // In production, check if any Chainlink feeds are accessible
    return Promise.resolve(false);
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
    const results = await Promise.allSettled(
      this.oracles.map((oracle) => oracle.isHealthy()),
    );
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
