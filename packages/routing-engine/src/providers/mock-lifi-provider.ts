/**
 * Mock LI.FI Provider
 *
 * Simulates the LI.FI bridge aggregator API for development and testing.
 * In production, replace with actual LI.FI API integration.
 *
 * LI.FI supports: Ethereum, Polygon, Arbitrum, Optimism, Base, BSC, Avalanche
 */

import type {
  RouteQuote,
  RouteQuoteParams,
  RouteExecutionResult,
  RouteStep,
} from '@crypto-gateway/shared';
import { BaseRouteProvider } from '../base-route-provider.js';

export interface MockLiFiConfig {
  /** Simulated fee in USD (default: 0.5) */
  simulatedFee?: number;
  /** Simulated execution time in seconds (default: 30) */
  simulatedTime?: number;
  /** Simulated security score 0-100 (default: 85) */
  securityScore?: number;
  /** Simulated reliability score 0-100 (default: 90) */
  reliabilityScore?: number;
  /** Simulated failure rate 0-1 (default: 0 = no failures) */
  failureRate?: number;
}

const DEFAULT_CONFIG: Required<MockLiFiConfig> = {
  simulatedFee: 0.5,
  simulatedTime: 30,
  securityScore: 85,
  reliabilityScore: 90,
  failureRate: 0,
};

export class MockLiFiProvider extends BaseRouteProvider {
  private readonly config: Required<MockLiFiConfig>;
  private executionCounter = 0;

  /** Chains supported by LI.FI */
  private readonly supportedChains = [
    'ethereum',
    'polygon',
    'arbitrum',
    'optimism',
    'base',
    'bsc',
    'avalanche',
  ];

  constructor(config?: MockLiFiConfig) {
    super('lifi');
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  getName(): string {
    return 'lifi';
  }

  getSupportedChains(): string[] {
    return [...this.supportedChains];
  }

  getSupportedAssets(_chain: string): string[] {
    return ['USDC', 'USDT', 'ETH', 'DAI', 'WBTC'];
  }

  protected async fetchRawQuote(params: RouteQuoteParams): Promise<unknown> {
    // Simulate network delay
    await this.delay(50 + Math.random() * 100);

    // Simulate random failures
    if (Math.random() < this.config.failureRate) {
      throw new Error('LI.FI API temporarily unavailable');
    }

    // Simulate cross-chain fee calculation
    const isCrossChain = params.source_chain !== params.target_chain;
    const fee = isCrossChain ? this.config.simulatedFee * 2 : this.config.simulatedFee;
    const time = isCrossChain ? this.config.simulatedTime * 1.5 : this.config.simulatedTime;

    return {
      id: `lifi-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      tool: 'lifi',
      fee: fee,
      time: time,
      steps: [
        {
          tool: 'lifi',
          toolData: { chains: [params.source_chain, params.target_chain] },
        },
      ],
    };
  }

  protected async normalizeQuote(raw: unknown, params: RouteQuoteParams): Promise<RouteQuote> {
    const data = raw as { id: string; fee: number; time: number; steps: unknown[] };

    const steps: RouteStep[] = [
      {
        chain: params.source_chain,
        protocol: 'lifi-aggregator',
        action: 'bridge',
        input_amount: params.source_amount,
        output_amount: params.source_amount - data.fee,
        fee: data.fee,
      },
    ];

    return {
      id: data.id,
      provider: 'lifi',
      source_chain: params.source_chain,
      source_asset: params.source_asset,
      source_amount: params.source_amount,
      target_chain: params.target_chain,
      target_asset: params.target_asset,
      target_amount: params.source_amount - data.fee,
      steps,
      estimated_fee: data.fee,
      estimated_time: data.time,
      security_score: this.config.securityScore,
      reliability_score: this.config.reliabilityScore,
      expires_at: new Date(Date.now() + 60_000), // 1 minute expiry
    };
  }

  protected async executeRaw(_route: RouteQuote): Promise<unknown> {
    await this.delay(100);
    this.executionCounter++;

    return {
      id: `lifi-exec-${this.executionCounter}`,
      status: 'COMPLETED',
      txHashes: [`0x${Math.random().toString(16).slice(2, 66)}`],
      fee: 0.5,
      time: 25,
    };
  }

  protected async normalizeResult(raw: unknown): Promise<RouteExecutionResult> {
    const data = raw as { id: string; status: string; txHashes: string[]; fee: number; time: number };

    return {
      execution_id: data.id,
      status: data.status as RouteExecutionResult['status'],
      transaction_hashes: data.txHashes,
      actual_fee: data.fee,
      actual_time: data.time,
    };
  }

  protected async fetchStatus(_executionId: string): Promise<RouteExecutionResult['status']> {
    await this.delay(20);
    return 'COMPLETED';
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
