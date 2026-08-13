/**
 * Mock Socket Provider
 *
 * Simulates the Socket bridge aggregator API for development and testing.
 * In production, replace with actual Socket API integration.
 *
 * Socket supports: Ethereum, Polygon, Arbitrum, Optimism, Base, BSC, Avalanche
 */

import type {
  RouteQuote,
  RouteQuoteParams,
  RouteExecutionResult,
  RouteStep,
} from '@crypto-gateway/shared';
import { BaseRouteProvider } from '../base-route-provider.js';

export interface MockSocketConfig {
  /** Simulated fee in USD (default: 0.3) */
  simulatedFee?: number;
  /** Simulated execution time in seconds (default: 25) */
  simulatedTime?: number;
  /** Simulated security score 0-100 (default: 80) */
  securityScore?: number;
  /** Simulated reliability score 0-100 (default: 85) */
  reliabilityScore?: number;
  /** Simulated failure rate 0-1 (default: 0 = no failures) */
  failureRate?: number;
}

const DEFAULT_CONFIG: Required<MockSocketConfig> = {
  simulatedFee: 0.3,
  simulatedTime: 25,
  securityScore: 80,
  reliabilityScore: 85,
  failureRate: 0,
};

export class MockSocketProvider extends BaseRouteProvider {
  private readonly config: Required<MockSocketConfig>;
  private executionCounter = 0;

  /** Chains supported by Socket */
  private readonly supportedChains = [
    'ethereum',
    'polygon',
    'arbitrum',
    'optimism',
    'base',
    'bsc',
    'avalanche',
  ];

  constructor(config?: MockSocketConfig) {
    super('socket');
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  getName(): string {
    return 'socket';
  }

  getSupportedChains(): string[] {
    return [...this.supportedChains];
  }

  getSupportedAssets(_chain: string): string[] {
    return ['USDC', 'USDT', 'ETH', 'DAI', 'WBTC'];
  }

  protected async fetchRawQuote(params: RouteQuoteParams): Promise<unknown> {
    await this.delay(40 + Math.random() * 80);

    if (Math.random() < this.config.failureRate) {
      throw new Error('Socket API temporarily unavailable');
    }

    const isCrossChain = params.source_chain !== params.target_chain;
    const fee = isCrossChain ? this.config.simulatedFee * 1.8 : this.config.simulatedFee;
    const time = isCrossChain ? this.config.simulatedTime * 1.3 : this.config.simulatedTime;

    return {
      id: `socket-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      source: params.source_chain,
      destination: params.target_chain,
      fee: fee,
      estimatedTime: time,
      steps: [],
    };
  }

  protected async normalizeQuote(raw: unknown, params: RouteQuoteParams): Promise<RouteQuote> {
    const data = raw as { id: string; fee: number; estimatedTime: number };

    const steps: RouteStep[] = [
      {
        chain: params.source_chain,
        protocol: 'socket-aggregator',
        action: 'bridge',
        input_amount: params.source_amount,
        output_amount: params.source_amount - data.fee,
        fee: data.fee,
      },
    ];

    return {
      id: data.id,
      provider: 'socket',
      source_chain: params.source_chain,
      source_asset: params.source_asset,
      source_amount: params.source_amount,
      target_chain: params.target_chain,
      target_asset: params.target_asset,
      target_amount: params.source_amount - data.fee,
      steps,
      estimated_fee: data.fee,
      estimated_time: data.estimatedTime,
      security_score: this.config.securityScore,
      reliability_score: this.config.reliabilityScore,
      expires_at: new Date(Date.now() + 60_000),
    };
  }

  protected async executeRaw(_route: RouteQuote): Promise<unknown> {
    await this.delay(80);
    this.executionCounter++;

    return {
      id: `socket-exec-${this.executionCounter}`,
      status: 'COMPLETED',
      txHashes: [`0x${Math.random().toString(16).slice(2, 66)}`],
      fee: 0.3,
      time: 20,
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
    await this.delay(15);
    return 'COMPLETED';
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
