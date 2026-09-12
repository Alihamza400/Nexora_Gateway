/**
 * Real LI.FI Route Provider
 *
 * Production adapter for LI.FI bridge aggregator API.
 * LI.FI supports: Ethereum, Polygon, Arbitrum, Optimism, Base, BSC, Avalanche
 *
 * API Reference: https://docs.li.fi/
 * Quote endpoint: POST https://api.li.fi/v2/quote
 * Status endpoint: GET https://api.li.fi/v1/status/{transactionId}
 *
 * Rate limits: ~100 rpm per API key. Cache aggressively and respect 429.
 */

import type {
  RouteQuote,
  RouteQuoteParams,
  RouteExecutionResult,
  RouteStep,
} from '@crypto-gateway/shared';
import { HttpClient, HttpError } from '@crypto-gateway/shared';
import { BaseRouteProvider } from '../base-route-provider.js';

// ─── LI.FI API Types ────────────────────────────────────────────────────────

interface LifiQuoteRequest {
  fromChain: number;
  toChain: number;
  fromToken: string;
  toToken: string;
  fromAmount: string;
  fromAddress: string;
  slippage: number;
  integrator?: string;
  fee?: number;
}

interface LifiQuoteResponse {
  id: string;
  fromChainId: number;
  toChainId: number;
  fromToken: { address: string; symbol: string; decimals: number; priceUSD: number };
  toToken: { address: string; symbol: string; decimals: number; priceUSD: number };
  fromAmount: string;
  toAmount: string;
  toAmountMin: string;
  feeCosts: Array<{
    name: string;
    amount: string;
    token: { symbol: string; decimals: number; priceUSD: number };
  }>;
  gasCosts: Array<{
    estimate: string;
    symbol: string;
    amount: string;
    amountUSD: string;
    token: { address: string; decimals: number; priceUSD: number };
  }>;
  steps: Array<{
    type: string;
    tool: string;
    action: {
      fromToken: string;
      toToken: string;
      fromAmount: string;
      toAmount: string;
      slippage: number;
    };
    estimate: { executionDuration: number; feeCosts: unknown[]; gasCosts: unknown[] };
  }>;
  gasEstimate: string;
  gasPriceUSD: string;
  executionDuration: number;
  validity: number;
}

interface LifiStatusResponse {
  status: 'PENDING' | 'DONE' | 'FAILED';
  substatus?: string;
  txHash?: string;
  receivingChainTxHash?: string;
  fromAddress?: string;
  toAddress?: string;
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

// ─── LI.FI Provider Config ───────────────────────────────────────────────────

export interface LifiProviderConfig {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
  slippage?: number;
  integrator?: string;
  fee?: number;
}

const DEFAULT_CONFIG: Required<Omit<LifiProviderConfig, 'apiKey'>> = {
  baseUrl: 'https://li.quest',
  timeoutMs: 15_000,
  maxRetries: 2,
  slippage: 0.03, // 3% slippage tolerance
  integrator: 'nexora-gateway',
  fee: 0, // No additional fee on top of LI.FI
};

// ─── LI.FI Route Provider ────────────────────────────────────────────────────

export class LifiRouteProvider extends BaseRouteProvider {
  private readonly httpClient: HttpClient;
  private readonly lifiConfig: Required<Omit<LifiProviderConfig, 'apiKey'>>;

  /** Chains supported by LI.FI (name → chainId) */
  private readonly supportedChains = new Map(
    Object.entries(CHAIN_NAME_TO_ID).filter(
      ([, id]) => ![11155111, 84532, 421614, 80002].includes(id), // Exclude testnets from default support
    ),
  );

  constructor(config: LifiProviderConfig) {
    super('lifi', { failureThreshold: 5, recoveryTimeout: 30_000 });
    // eslint-disable-next-line @typescript-eslint/naming-convention, @typescript-eslint/no-unused-vars
    const { apiKey: _apiKey, ...rest } = config;
    this.lifiConfig = { ...DEFAULT_CONFIG, ...rest };
    this.httpClient = new HttpClient({
      baseUrl: config.baseUrl ?? DEFAULT_CONFIG.baseUrl,
      apiKey: config.apiKey,
      apiKeyHeader: 'X-API-KEY',
      timeoutMs: config.timeoutMs ?? DEFAULT_CONFIG.timeoutMs,
      maxRetries: 0, // We handle retries at the provider level
      userAgent: 'NexoraCryptoGateway/1.0 (LI.FI Adapter)',
    });
  }

  getName(): string {
    return 'lifi';
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

    const body: LifiQuoteRequest = {
      fromChain: fromChainId,
      toChain: toChainId,
      fromToken,
      toToken,
      fromAmount: this.toWei(params.source_amount, params.source_asset),
      fromAddress: '0x0000000000000000000000000000000000000000', // Placeholder for quote
      slippage: this.lifiConfig.slippage,
      integrator: this.lifiConfig.integrator,
      fee: this.lifiConfig.fee,
    };

    const response = await this.httpClient.post<LifiQuoteResponse>('/v2/quote', body, {
      timeoutMs: this.lifiConfig.timeoutMs,
      idempotent: true,
    });

    return response.data;
  }

  protected normalizeQuote(raw: unknown, params: RouteQuoteParams): Promise<RouteQuote> {
    const data = raw as LifiQuoteResponse;

    // Parse fee costs
    const totalFeeCostUsd =
      data.feeCosts?.reduce((sum, fee) => {
        return sum + (parseFloat(fee.amount) || 0) * (fee.token?.priceUSD || 0);
      }, 0) ?? 0;

    // Parse gas costs
    const totalGasCostUsd =
      data.gasCosts?.reduce((sum, gas) => {
        return sum + parseFloat(gas.amountUSD || '0');
      }, 0) ?? 0;

    const estimatedFee = totalFeeCostUsd + totalGasCostUsd;

    // Parse target amount
    const toAmount = data.toAmount
      ? parseFloat(data.toAmount) / Math.pow(10, data.toToken.decimals)
      : params.source_amount;

    // Build steps from LI.FI steps
    const steps: RouteStep[] = data.steps.map((step) => ({
      chain: CHAIN_ID_TO_NAME[fromChainId(data)] ?? params.source_chain,
      protocol: step.tool,
      action: step.type,
      input_amount: parseFloat(step.action.fromAmount) / Math.pow(10, 18), // Simplified
      output_amount: parseFloat(step.action.toAmount) / Math.pow(10, data.toToken.decimals),
      fee: 0, // Fees are aggregated at the quote level
    }));

    // If no steps, create a single step
    if (steps.length === 0) {
      steps.push({
        chain: params.source_chain,
        protocol: 'lifi',
        action: 'bridge',
        input_amount: params.source_amount,
        output_amount: toAmount,
        fee: estimatedFee,
      });
    }

    const quote: RouteQuote = {
      id: data.id,
      provider: 'lifi',
      source_chain: params.source_chain,
      source_asset: params.source_asset,
      source_amount: params.source_amount,
      target_chain: params.target_chain,
      target_asset: params.target_asset,
      target_amount: toAmount,
      steps,
      estimated_fee: estimatedFee,
      estimated_time: data.executionDuration ?? 30,
      security_score: this.calculateSecurityScore(data),
      reliability_score: this.calculateReliabilityScore(data),
      expires_at: new Date(Date.now() + (data.validity ?? 60) * 1000),
    };

    return Promise.resolve(quote);
  }

  protected executeRaw(_route: RouteQuote): Promise<unknown> {
    // LI.FI execution requires a real user address and transaction signing
    // In production, this would be called by the settlement service with the actual signer
    // For now, we return the route details for the caller to execute
    const result = {
      id: _route.id,
      status: 'PENDING',
      txHashes: [],
      route: _route,
    };
    return Promise.resolve(result);
  }

  protected normalizeResult(raw: unknown): Promise<RouteExecutionResult> {
    const data = raw as { id: string; status: string; txHashes: string[] };

    const result: RouteExecutionResult = {
      execution_id: data.id,
      status: this.mapStatus(data.status),
      transaction_hashes: data.txHashes,
      actual_fee: 0, // Will be updated when transaction is confirmed
      actual_time: 0, // Will be updated when transaction is confirmed
    };

    return Promise.resolve(result);
  }

  protected async fetchStatus(executionId: string): Promise<RouteExecutionResult['status']> {
    try {
      const response = await this.httpClient.get<LifiStatusResponse>(`/v1/status/${executionId}`, {
        timeoutMs: 10_000,
        idempotent: true,
      });

      return this.mapStatus(response.data.status);
    } catch (error) {
      // If status check fails, return PENDING (don't fail the whole flow)
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
      throw new Error(`Chain ${chainName} is not supported by LI.FI`);
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
      // For unknown tokens, use the zero address as placeholder
      // In production, this would need to be resolved via token list
      throw new Error(`Token ${asset} on chain ${chainId} is not configured for LI.FI`);
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

  private calculateSecurityScore(data: LifiQuoteResponse): number {
    // Base score based on the tools used
    let score = 70;

    // Higher score for established tools
    const knownTools = ['hop', 'connext', 'stargate', 'across', 'woofi', 'pancakeswap'];
    const usedTools = data.steps?.map((s) => s.tool.toLowerCase()) ?? [];
    const knownToolCount = usedTools.filter((t) => knownTools.some((k) => t.includes(k))).length;
    score += Math.min(knownToolCount * 5, 15);

    // Lower score for very high slippage
    const avgSlippage =
      data.steps?.reduce((sum, s) => sum + (s.action.slippage ?? 0), 0) / (data.steps?.length ?? 1);
    if (avgSlippage > 0.05) score -= 10;

    return Math.max(0, Math.min(100, score));
  }

  private calculateReliabilityScore(data: LifiQuoteResponse): number {
    // Base score
    let score = 75;

    // Higher score for shorter execution time
    if (data.executionDuration < 60) score += 10;
    else if (data.executionDuration < 300) score += 5;
    else if (data.executionDuration > 600) score -= 10;

    // Higher score for single-step routes (less failure points)
    if (data.steps?.length === 1) score += 5;
    else if (data.steps?.length > 3) score -= 5;

    return Math.max(0, Math.min(100, score));
  }

  private mapStatus(status: string): RouteExecutionResult['status'] {
    switch (status?.toUpperCase()) {
      case 'COMPLETED':
      case 'DONE':
        return 'COMPLETED';
      case 'FAILED':
        return 'FAILED';
      case 'PENDING':
      case 'WAITING':
        return 'PENDING';
      case 'EXECUTING':
      case 'IN_PROGRESS':
        return 'EXECUTING';
      case 'REFUNDED':
        return 'REFUNDED';
      default:
        return 'PENDING';
    }
  }
}

function fromChainId(data: LifiQuoteResponse): number {
  return data.fromChainId;
}
