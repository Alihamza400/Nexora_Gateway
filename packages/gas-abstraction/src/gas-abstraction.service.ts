import type {
  IGasAbstraction,
  GasAbstractionStrategy,
  GasCostEstimate,
  GaslessFee,
  PaymasterRequest,
  RelayerRequest,
  RelayerTransaction,
  GaslessExecutionResult,
  PaymasterConfig,
  RelayerConfig,
  IChainClient,
} from '@crypto-gateway/shared';

/**
 * Chain-specific gas abstraction configuration.
 */
interface ChainGasConfig {
  chainId: string;
  strategy: GasAbstractionStrategy;
  nativeSymbol: string;
  nativeDecimals: number;
  nativePriceUsd: number;
  paymasterConfig?: PaymasterConfig;
  relayerConfig?: RelayerConfig;
}

/**
 * Default chain configurations.
 */
const DEFAULT_CHAIN_CONFIGS: Map<string, ChainGasConfig> = new Map([
  ['1', {
    chainId: '1',
    strategy: 'ERC4337_PAYMASTER',
    nativeSymbol: 'ETH',
    nativeDecimals: 18,
    nativePriceUsd: 3500,
  }],
  ['8453', {
    chainId: '8453',
    strategy: 'ERC4337_PAYMASTER',
    nativeSymbol: 'ETH',
    nativeDecimals: 18,
    nativePriceUsd: 3500,
  }],
  ['42161', {
    chainId: '42161',
    strategy: 'ERC4337_PAYMASTER',
    nativeSymbol: 'ETH',
    nativeDecimals: 18,
    nativePriceUsd: 3500,
  }],
  ['137', {
    chainId: '137',
    strategy: 'RELAYER',
    nativeSymbol: 'MATIC',
    nativeDecimals: 18,
    nativePriceUsd: 0.8,
  }],
  ['tron', {
    chainId: 'tron',
    strategy: 'RESOURCE_MODEL',
    nativeSymbol: 'TRX',
    nativeDecimals: 6,
    nativePriceUsd: 0.12,
  }],
  ['solana', {
    chainId: 'solana',
    strategy: 'PRIORITY_FEE_RELAY',
    nativeSymbol: 'SOL',
    nativeDecimals: 9,
    nativePriceUsd: 150,
  }],
]);

/**
 * Gas Abstraction Service
 *
 * Provides gasless transaction support across multiple chains:
 * - EVM with AA: ERC-4337 paymaster (Alchemy, Biconomy, Pimlico)
 * - EVM without AA: Relayer pattern
 * - Tron: Energy/bandwidth resource model
 * - Solana: Priority fee relay
 *
 * This service:
 * 1. Determines the best gas strategy for each chain
 * 2. Estimates costs (native and token)
 * 3. Prepares gasless transactions
 * 4. Executes through paymaster/relayer
 */
export class GasAbstractionService implements IGasAbstraction {
  private readonly chainConfigs: Map<string, ChainGasConfig>;
  private readonly chainClients: Map<string, IChainClient>;

  constructor(
    chainClients: Map<string, IChainClient>,
    customConfigs?: Map<string, Partial<ChainGasConfig>>,
  ) {
    this.chainClients = chainClients;
    this.chainConfigs = new Map(DEFAULT_CHAIN_CONFIGS);

    // Merge custom configs
    if (customConfigs) {
      for (const [chainId, config] of customConfigs) {
        const existing = this.chainConfigs.get(chainId);
        if (existing) {
          this.chainConfigs.set(chainId, { ...existing, ...config });
        } else {
          this.chainConfigs.set(chainId, config as ChainGasConfig);
        }
      }
    }
  }

  // ─── Strategy Detection ──────────────────────────────────────────────

  getStrategy(chainId: string): GasAbstractionStrategy {
    const config = this.chainConfigs.get(chainId);
    if (!config) {
      // Default to relayer for unknown EVM chains
      return 'RELAYER';
    }
    return config.strategy;
  }

  // ─── Gas Cost Estimation ────────────────────────────────────────────

  async estimateGasCost(params: {
    chainId: string;
    from: string;
    to: string;
    value: string;
    data: string;
    gasToken?: string;
  }): Promise<GasCostEstimate> {
    const config = this.chainConfigs.get(params.chainId);
    const chainClient = this.chainClients.get(params.chainId);

    if (!config || !chainClient) {
      return this.estimateDefaultGasCost(params);
    }

    // Get base gas estimate from chain client with error handling
    let gasEstimate;
    try {
      gasEstimate = await chainClient.estimateGas({
        from: params.from,
        to: params.to,
        value: params.value,
        data: params.data,
      });
    } catch {
      // Fall back to default estimate on error
      return this.estimateDefaultGasCost(params);
    }

    // Calculate native cost
    const nativeCost = gasEstimate.totalCost;
    const usdCost = gasEstimate.totalCostUSD;

    // Check if gasless is available
    const gaslessAvailable = await this.isGaslessAvailable(params.chainId, params.gasToken);

    // Calculate gasless fee if available
    let gaslessFee: GaslessFee | undefined;
    if (gaslessAvailable && config.relayerConfig) {
      const feePercentage = config.relayerConfig.feePercentage;
      gaslessFee = {
        percentage: feePercentage,
        usdAmount: usdCost * (feePercentage / 100),
        tokenAmount: 0, // Will be calculated based on payment token
        tokenSymbol: params.gasToken ?? config.nativeSymbol,
      };
    }

    // Calculate token cost if paying with ERC-20
    let tokenCost: number | undefined;
    let tokenSymbol: string | undefined;
    if (params.gasToken) {
      // In production, fetch token price from oracle
      tokenCost = usdCost / 1; // Assume 1 USD per stablecoin
      tokenSymbol = params.gasToken;
    }

    return {
      chainId: params.chainId,
      strategy: config.strategy,
      nativeCost,
      nativeSymbol: config.nativeSymbol,
      usdCost,
      tokenCost,
      tokenSymbol,
      gasLimit: gasEstimate.gasLimit,
      gasPrice: gasEstimate.gasPrice,
      gaslessAvailable,
      gaslessFee,
    };
  }

  // ─── Gasless Availability ───────────────────────────────────────────

  async isGaslessAvailable(chainId: string, token?: string): Promise<boolean> {
    const config = this.chainConfigs.get(chainId);
    if (!config) return false;

    switch (config.strategy) {
      case 'ERC4337_PAYMASTER':
        // Check if paymaster is configured
        return !!config.paymasterConfig;

      case 'RELAYER':
        // Check if relayer is configured and token is allowed
        if (!config.relayerConfig) return false;
        // Relayer typically accepts stablecoins for fee payment
        return !token || this.isAcceptedFeeToken(token);

      case 'RESOURCE_MODEL':
        // Tron: Gasless not typically supported for external users
        return false;

      case 'PRIORITY_FEE_RELAY':
        // Solana: Priority fee relay available
        return !!config.relayerConfig;

      default:
        return false;
    }
  }

  // ─── Prepare Gasless Transaction ────────────────────────────────────

  async prepareGasless(params: {
    chainId: string;
    transaction: RelayerTransaction;
    senderAddress: string;
    gasToken?: string;
  }): Promise<PaymasterRequest | RelayerRequest> {
    const config = this.chainConfigs.get(params.chainId);
    if (!config) {
      throw new Error(`No gas abstraction config for chain ${params.chainId}`);
    }

    switch (config.strategy) {
      case 'ERC4337_PAYMASTER':
        return this.preparePaymasterRequest(params, config);

      case 'RELAYER':
      case 'PRIORITY_FEE_RELAY':
        return this.prepareRelayerRequest(params, config);

      default:
        throw new Error(`Gasless not supported for strategy ${config.strategy}`);
    }
  }

  // ─── Execute Gasless Transaction ────────────────────────────────────

  async executeGasless(params: {
    chainId: string;
    preparedRequest: PaymasterRequest | RelayerRequest;
  }): Promise<GaslessExecutionResult> {
    const config = this.chainConfigs.get(params.chainId);
    if (!config) {
      return {
        success: false,
        txHash: '',
        cost: this.createDefaultCostEstimate(params.chainId),
        error: `No gas abstraction config for chain ${params.chainId}`,
      };
    }

    try {
      switch (config.strategy) {
        case 'ERC4337_PAYMASTER':
          return await this.executePaymaster(params.preparedRequest as PaymasterRequest, config);

        case 'RELAYER':
        case 'PRIORITY_FEE_RELAY':
          return await this.executeRelayer(params.preparedRequest as RelayerRequest, config);

        default:
          return {
            success: false,
            txHash: '',
            cost: this.createDefaultCostEstimate(params.chainId),
            error: `Unsupported strategy: ${config.strategy}`,
          };
      }
    } catch (error) {
      return {
        success: false,
        txHash: '',
        cost: this.createDefaultCostEstimate(params.chainId),
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ─── Paymaster Methods ──────────────────────────────────────────────

  private async preparePaymasterRequest(
    params: {
      chainId: string;
      transaction: RelayerTransaction;
      senderAddress: string;
      gasToken?: string;
    },
    config: ChainGasConfig,
  ): Promise<PaymasterRequest> {
    // In production, this would:
    // 1. Connect to paymaster service (Alchemy/Biconomy/Pimlico)
    // 2. Request sponsorship for the user operation
    // 3. Return signed paymaster data

    // Simulate paymaster request
    const userOperation = {
      sender: params.senderAddress,
      nonce: 0,
      callData: params.transaction.data,
      callGasLimit: 200000,
      verificationGasLimit: 50000,
      preVerificationGas: 21000,
      maxFeePerGas: 20000000000, // 20 gwei
      maxPriorityFeePerGas: 2000000000, // 2 gwei
      paymasterAndData: config.paymasterConfig?.address ?? '0x',
      signature: '0x',
    };

    return {
      userOperation,
      chainId: params.chainId,
      gasToken: params.gasToken,
    };
  }

  private async executePaymaster(
    request: PaymasterRequest,
    config: ChainGasConfig,
  ): Promise<GaslessExecutionResult> {
    // In production, this would:
    // 1. Submit the user operation to the bundler
    // 2. Wait for inclusion
    // 3. Return the transaction hash

    const txHash = `0x${this.generateHash(64)}`;

    return {
      success: true,
      txHash,
      cost: {
        chainId: config.chainId,
        strategy: config.strategy,
        nativeCost: 0, // Sponsored by paymaster
        nativeSymbol: config.nativeSymbol,
        usdCost: 0,
        gasLimit: request.userOperation.callGasLimit,
        gasPrice: request.userOperation.maxFeePerGas,
        gaslessAvailable: true,
        gaslessFee: {
          percentage: 0,
          usdAmount: 0,
          tokenAmount: 0,
          tokenSymbol: request.gasToken ?? config.nativeSymbol,
        },
      },
    };
  }

  // ─── Relayer Methods ────────────────────────────────────────────────

  private async prepareRelayerRequest(
    params: {
      chainId: string;
      transaction: RelayerTransaction;
      senderAddress: string;
      gasToken?: string;
    },
    config: ChainGasConfig,
  ): Promise<RelayerRequest> {
    // In production, this would:
    // 1. Connect to relayer service
    // 2. Estimate relayer fee
    // 3. Return relayer request

    return {
      transaction: params.transaction,
      senderAddress: params.senderAddress,
      maxFeeWei: '100000000000000000', // 0.1 ETH max fee
    };
  }

  private async executeRelayer(
    request: RelayerRequest,
    config: ChainGasConfig,
  ): Promise<GaslessExecutionResult> {
    // In production, this would:
    // 1. Submit transaction to relayer
    // 2. Relayer signs and submits
    // 3. Return the transaction hash

    const txHash = `0x${this.generateHash(64)}`;
    const feeWei = BigInt(request.maxFeeWei) / 10n; // 10% of max fee
    const feeEth = Number(feeWei) / 1e18;

    return {
      success: true,
      txHash,
      cost: {
        chainId: config.chainId,
        strategy: config.strategy,
        nativeCost: feeEth,
        nativeSymbol: config.nativeSymbol,
        usdCost: feeEth * config.nativePriceUsd,
        gasLimit: 200000,
        gasPrice: 20000000000,
        gaslessAvailable: true,
        gaslessFee: {
          percentage: config.relayerConfig?.feePercentage ?? 1,
          usdAmount: feeEth * config.nativePriceUsd,
          tokenAmount: feeEth,
          tokenSymbol: request.gasToken ?? config.nativeSymbol,
        },
      },
    };
  }

  // ─── Helper Methods ──────────────────────────────────────────────────

  private async estimateDefaultGasCost(params: {
    chainId: string;
    from: string;
    to: string;
    value: string;
    data: string;
    gasToken?: string;
  }): Promise<GasCostEstimate> {
    // Default estimation for unknown chains
    return {
      chainId: params.chainId,
      strategy: 'RELAYER',
      nativeCost: 0.001,
      nativeSymbol: 'ETH',
      usdCost: 3.5,
      gasLimit: 21000,
      gasPrice: 20000000000,
      gaslessAvailable: false,
    };
  }

  private createDefaultCostEstimate(chainId: string): GasCostEstimate {
    const config = this.chainConfigs.get(chainId);
    return {
      chainId,
      strategy: config?.strategy ?? 'RELAYER',
      nativeCost: 0,
      nativeSymbol: config?.nativeSymbol ?? 'ETH',
      usdCost: 0,
      gasLimit: 0,
      gasPrice: 0,
      gaslessAvailable: false,
    };
  }

  private isAcceptedFeeToken(token: string): boolean {
    const acceptedTokens = ['USDC', 'USDT', 'DAI'];
    return acceptedTokens.includes(token.toUpperCase());
  }

  private generateHash(length: number): string {
    const chars = '0123456789abcdef';
    let hash = '';
    for (let i = 0; i < length; i++) {
      hash += chars[Math.floor(Math.random() * chars.length)];
    }
    return hash;
  }
}
