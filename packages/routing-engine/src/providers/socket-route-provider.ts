/**
 * Real Socket (Bungee) Route Provider
 *
 * Production adapter for Socket/Bungee bridge aggregator API.
 * Socket supports: Ethereum, Polygon, Arbitrum, Optimism, Base, BSC, Avalanche, and more.
 *
 * API Reference: https://docs.socket.tech/
 * Quote endpoint: POST https://api.socket.tech/v2/quote
 * Status endpoint: GET https://api.socket.tech/v2/transaction/{txHash}
 *
 * Rate limits: Varies by plan. Cache aggressively.
 */

import type {
  RouteQuote,
  RouteQuoteParams,
  RouteExecutionResult,
  RouteStep,
} from '@crypto-gateway/shared';
import { HttpClient, HttpError } from '@crypto-gateway/shared';
import { BaseRouteProvider } from '../base-route-provider.js';

// ─── Socket API Types ────────────────────────────────────────────────────────

interface SocketQuoteRequest {
  fromChainId: number;
  toChainId: number;
  fromTokenAddress: string;
  toTokenAddress: string;
  fromAmount: string;
  userAddress: string;
  sort: 'output' | 'gas' | 'time';
  singleTxOnly: boolean;
  recipient?: string;
}

interface SocketQuoteResponse {
  result: {
    routes: Array<{
      id: string;
      userId: string;
      fromChainId: number;
      toChainId: number;
      fromAsset: { address: string; symbol: string; decimals: number; priceUSD: number };
      toAsset: { address: string; symbol: string; decimals: number; priceUSD: number };
      fromAmount: string;
      toAmount: string;
      minimumAmountOut: string;
      totalGasFeesInUsd: number;
      totalRelayerFeesInUsd: number;
      protocolFees: { symbol: string; amount: string; amountInUsd: number }[];
      steps: Array<{
        type: string;
        protocol: { name: string; part: number };
        stepFromAsset: { address: string; symbol: string; decimals: number };
        stepToAsset: { address: string; symbol: string; decimals: number };
        chainId: number;
        estimatedGas: string;
        gasLimit: number;
      }>;
      maxTime: number;
    }>;
  };
  success: boolean;
}

interface SocketStatusResponse {
  sourceTxStatus: string;
  destinationTxStatus: string;
  sourceTxHash?: string;
  destinationTxHash?: string;
  nodeStatus?: string;
}

// ─── Chain ID Mapping ────────────────────────────────────────────────────────

const CHAIN_NAME_TO_ID: Record<string, number> = {
  ethereum: 1,
  polygon: 137,
  arbitrum: 42161,
  optimism: 10,
  base: 8453,
  bsc: 56,
  avalanche: 43114,
  gnosis: 100,
  fantom: 250,
  moonbeam: 1284,
  zksync: 324,
  linea: 59144,
  scroll: 534352,
  mantle: 5000,
  mode: 34443,
  blast: 81457,
  manta: 169,
  // Testnets
  sepolia: 11155111,
  'base-sepolia': 84532,
  'arbitrum-sepolia': 421614,
  'polygon-amoy': 80002,
};

const CHAIN_ID_TO_NAME: Record<number, string> = Object.fromEntries(
  Object.entries(CHAIN_NAME_TO_ID).map(([name, id]) => [id, name]),
);

// ─── Token Address Mapping ───────────────────────────────────────────────────

const TOKEN_ADDRESSES: Record<number, Record<string, string>> = {
  1: {
    ETH: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
    USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    USDT: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    DAI: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
    WBTC: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
  },
  137: {
    USDC: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
    USDT: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
    DAI: '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063',
    WMATIC: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270',
  },
  42161: {
    ETH: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
    USDC: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    USDT: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
    DAI: '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1',
  },
  8453: {
    ETH: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
    USDC: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    DAI: '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb',
  },
  10: {
    ETH: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
    USDC: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
    USDT: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58',
    DAI: '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1',
  },
};

// ─── Socket Provider Config ──────────────────────────────────────────────────

export interface SocketProviderConfig {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
  sort?: 'output' | 'gas' | 'time';
  singleTxOnly?: boolean;
}

const DEFAULT_CONFIG: Required<Omit<SocketProviderConfig, 'apiKey'>> = {
  baseUrl: 'https://api.socket.tech',
  timeoutMs: 15_000,
  maxRetries: 2,
  sort: 'output',
  singleTxOnly: true,
};

// ─── Socket Route Provider ───────────────────────────────────────────────────

export class SocketRouteProvider extends BaseRouteProvider {
  private readonly httpClient: HttpClient;
  private readonly socketConfig: Required<Omit<SocketProviderConfig, 'apiKey'>>;

  /** Chains supported by Socket */
  private readonly supportedChains = new Map(
    Object.entries(CHAIN_NAME_TO_ID).filter(
      ([, id]) => ![11155111, 84532, 421614, 80002].includes(id), // Exclude testnets
    ),
  );

  constructor(config: SocketProviderConfig) {
    super('socket', { failureThreshold: 5, recoveryTimeout: 30_000 });
    // eslint-disable-next-line @typescript-eslint/naming-convention, @typescript-eslint/no-unused-vars
    const { apiKey: _apiKey, ...rest } = config;
    this.socketConfig = { ...DEFAULT_CONFIG, ...rest };
    this.httpClient = new HttpClient({
      baseUrl: config.baseUrl ?? DEFAULT_CONFIG.baseUrl,
      apiKey: config.apiKey,
      apiKeyHeader: 'API-KEY',
      timeoutMs: config.timeoutMs ?? DEFAULT_CONFIG.timeoutMs,
      maxRetries: 0,
      userAgent: 'NexoraCryptoGateway/1.0 (Socket Adapter)',
    });
  }

  getName(): string {
    return 'socket';
  }

  getSupportedChains(): string[] {
    return [...this.supportedChains.keys()];
  }

  getSupportedAssets(_chain: string): string[] {
    return ['ETH', 'USDC', 'USDT', 'DAI', 'WBTC', 'MATIC', 'ARB', 'OP', 'BNB', 'AVAX'];
  }

  // ─── Raw API Calls ──────────────────────────────────────────────────────

  protected async fetchRawQuote(params: RouteQuoteParams): Promise<unknown> {
    const fromChainId = this.resolveChainId(params.source_chain);
    const toChainId = this.resolveChainId(params.target_chain);
    const fromToken = this.resolveTokenAddress(fromChainId, params.source_asset);
    const toToken = this.resolveTokenAddress(toChainId, params.target_asset);

    const body: SocketQuoteRequest = {
      fromChainId,
      toChainId,
      fromTokenAddress: fromToken,
      toTokenAddress: toToken,
      fromAmount: this.toWei(params.source_amount, params.source_asset),
      userAddress: '0x0000000000000000000000000000000000000000', // Placeholder for quote
      sort: this.socketConfig.sort,
      singleTxOnly: this.socketConfig.singleTxOnly,
    };

    const response = await this.httpClient.post<SocketQuoteResponse>('/v2/quote', body, {
      timeoutMs: this.socketConfig.timeoutMs,
      idempotent: true,
    });

    if (!response.data.success || !response.data.result.routes.length) {
      throw new Error('No routes found from Socket');
    }

    // Return the best route (first in the sorted array)
    return response.data.result.routes[0];
  }

  protected normalizeQuote(raw: unknown, params: RouteQuoteParams): Promise<RouteQuote> {
    const route = raw as SocketQuoteResponse['result']['routes'][0];

    // Parse protocol fees
    const totalProtocolFeeUsd =
      route.protocolFees?.reduce((sum, fee) => {
        return sum + (fee.amountInUsd || 0);
      }, 0) ?? 0;

    const estimatedFee =
      (route.totalGasFeesInUsd || 0) + (route.totalRelayerFeesInUsd || 0) + totalProtocolFeeUsd;

    // Parse target amount
    const toAmount = route.toAmount
      ? parseFloat(route.toAmount) / Math.pow(10, route.toAsset.decimals)
      : params.source_amount;

    // Build steps from Socket steps
    const steps: RouteStep[] = route.steps.map((step) => ({
      chain: CHAIN_ID_TO_NAME[step.chainId] ?? params.source_chain,
      protocol: step.protocol.name,
      action: step.type,
      input_amount:
        parseFloat(
          step.stepFromAsset.address === '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'
            ? params.source_amount.toString()
            : '0',
        ) / Math.pow(10, step.stepFromAsset.decimals),
      output_amount: 0, // Will be calculated from route
      fee: 0, // Fees are aggregated at the route level
    }));

    // If no steps, create a single step
    if (steps.length === 0) {
      steps.push({
        chain: params.source_chain,
        protocol: 'socket',
        action: 'bridge',
        input_amount: params.source_amount,
        output_amount: toAmount,
        fee: estimatedFee,
      });
    }

    const quote: RouteQuote = {
      id: route.id,
      provider: 'socket',
      source_chain: params.source_chain,
      source_asset: params.source_asset,
      source_amount: params.source_amount,
      target_chain: params.target_chain,
      target_asset: params.target_asset,
      target_amount: toAmount,
      steps,
      estimated_fee: estimatedFee,
      estimated_time: route.maxTime ?? 30,
      security_score: this.calculateSecurityScore(route),
      reliability_score: this.calculateReliabilityScore(route),
      expires_at: new Date(Date.now() + 60 * 1000), // 1 minute default
    };

    return Promise.resolve(quote);
  }

  protected executeRaw(route: RouteQuote): Promise<unknown> {
    // Socket execution requires a real user address and transaction signing
    // In production, this would be called by the settlement service with the actual signer
    const result = {
      id: route.id,
      status: 'PENDING',
      txHashes: [],
      route: route,
    };
    return Promise.resolve(result);
  }

  protected normalizeResult(raw: unknown): Promise<RouteExecutionResult> {
    const data = raw as { id: string; status: string; txHashes: string[] };

    const result: RouteExecutionResult = {
      execution_id: data.id,
      status: this.mapStatus(data.status),
      transaction_hashes: data.txHashes,
      actual_fee: 0,
      actual_time: 0,
    };

    return Promise.resolve(result);
  }

  protected async fetchStatus(executionId: string): Promise<RouteExecutionResult['status']> {
    try {
      const response = await this.httpClient.get<SocketStatusResponse>(
        `/v2/transaction/${executionId}`,
        { timeoutMs: 10_000, idempotent: true },
      );

      const status = response.data.destinationTxStatus ?? response.data.sourceTxStatus;
      return this.mapStatus(status);
    } catch (error) {
      if (error instanceof HttpError && error.status === 404) {
        return 'PENDING';
      }
      throw error;
    }
  }

  // ─── Helper Methods ─────────────────────────────────────────────────────

  private resolveChainId(chainName: string): number {
    const id = CHAIN_NAME_TO_ID[chainName.toLowerCase()];
    if (id === undefined) {
      throw new Error(`Chain ${chainName} is not supported by Socket`);
    }
    return id;
  }

  private resolveTokenAddress(chainId: number, asset: string): string {
    const upperAsset = asset.toUpperCase();
    const tokens = TOKEN_ADDRESSES[chainId];

    if (upperAsset === 'ETH' && chainId === 1) {
      return tokens?.ETH ?? '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
    }

    const address = tokens?.[upperAsset];
    if (!address) {
      throw new Error(`Token ${asset} on chain ${chainId} is not configured for Socket`);
    }

    return address;
  }

  private toWei(amount: number, asset: string): string {
    const decimals = this.getDecimals(asset);
    return BigInt(Math.round(amount * Math.pow(10, decimals))).toString();
  }

  private getDecimals(asset: string): number {
    const upper = asset.toUpperCase();
    switch (upper) {
      case 'ETH':
      case 'MATIC':
      case 'ARB':
      case 'OP':
      case 'BNB':
      case 'AVAX':
      case 'FTM':
        return 18;
      case 'USDC':
      case 'USDT':
        return 6;
      case 'WBTC':
        return 8;
      case 'DAI':
        return 18;
      default:
        return 18;
    }
  }

  private calculateSecurityScore(route: SocketQuoteResponse['result']['routes'][0]): number {
    let score = 72;

    // Higher score for established protocols
    const knownProtocols = ['hop', 'connext', 'stargate', 'across', 'woofi', 'synapse', 'lifi'];
    const usedProtocols = route.steps?.map((s) => s.protocol.name.toLowerCase()) ?? [];
    const knownCount = usedProtocols.filter((p) =>
      knownProtocols.some((k) => p.includes(k)),
    ).length;
    score += Math.min(knownCount * 4, 12);

    // Lower score for high fee routes
    const feeRatio =
      (route.totalGasFeesInUsd + route.totalRelayerFeesInUsd) / (parseFloat(route.toAmount) / 1e18);
    if (feeRatio > 0.05) score -= 8;

    return Math.max(0, Math.min(100, score));
  }

  private calculateReliabilityScore(route: SocketQuoteResponse['result']['routes'][0]): number {
    let score = 73;

    // Higher score for shorter execution time
    if (route.maxTime < 60) score += 10;
    else if (route.maxTime < 300) score += 5;
    else if (route.maxTime > 600) score -= 10;

    // Higher score for single-tx routes
    if (route.steps?.length === 1) score += 5;
    else if (route.steps?.length > 3) score -= 5;

    return Math.max(0, Math.min(100, score));
  }

  private mapStatus(status: string): RouteExecutionResult['status'] {
    switch (status?.toLowerCase()) {
      case 'completed':
      case 'confirmed':
      case 'success':
        return 'COMPLETED';
      case 'failed':
      case 'reverted':
        return 'FAILED';
      case 'pending':
      case 'waiting':
      case 'indexing':
        return 'PENDING';
      case 'executing':
      case 'in_progress':
      case 'src-pending':
      case 'src-defined':
        return 'EXECUTING';
      case 'refunded':
        return 'REFUNDED';
      default:
        return 'PENDING';
    }
  }
}
