/**
 * Gas Abstraction Types
 * Unified interfaces for gasless transactions across chains.
 */

// ─── Gas Abstraction Strategy ─────────────────────────────────────────────

export type GasAbstractionStrategy =
  | 'ERC4337_PAYMASTER'    // EVM with Account Abstraction
  | 'RELAYER'              // EVM without AA
  | 'RESOURCE_MODEL'       // Tron (energy/bandwidth)
  | 'PRIORITY_FEE_RELAY'; // Solana

// ─── Paymaster Types ──────────────────────────────────────────────────────

export interface PaymasterConfig {
  /** Paymaster contract address */
  address: string;
  /** RPC URL for the chain */
  rpcUrl: string;
  /** API key for paymaster service (Alchemy, Biconomy, Pimlico) */
  apiKey?: string;
  /** Sponsor policy */
  sponsorPolicy: SponsorPolicy;
}

export type SponsorPolicy =
  | 'ALL'           // Sponsor all transactions
  | 'ERC20_ONLY'    // Only sponsor ERC-20 transfers
  | 'WHITELIST'     // Only sponsor whitelisted addresses
  | 'RULES_BASED';  // Sponsor based on rules (amount, token, etc.)

export interface PaymasterRequest {
  /** User operation to sponsor */
  userOperation: UserOperation;
  /** Chain ID */
  chainId: string;
  /** Optional: specific token to pay gas with */
  gasToken?: string;
}

export interface PaymasterResult {
  /** Whether the paymaster will sponsor the transaction */
  sponsored: boolean;
  /** Paymaster address that will sign */
  paymasterAddress: string;
  /** Signed paymaster data */
  paymasterData: string;
  /** Gas limit for the paymaster */
  paymasterGasLimit: number;
  /** Verification gas limit */
  verificationGasLimit: number;
  /** Pre-verification gas */
  preVerificationGas: number;
}

export interface UserOperation {
  sender: string;
  nonce: number;
  callData: string;
  callGasLimit: number;
  verificationGasLimit: number;
  preVerificationGas: number;
  maxFeePerGas: number;
  maxPriorityFeePerGas: number;
  paymasterAndData: string;
  signature: string;
}

// ─── Relayer Types ────────────────────────────────────────────────────────

export interface RelayerConfig {
  /** Relayer service URL */
  relayerUrl: string;
  /** API key for relayer service */
  apiKey: string;
  /** Chain ID */
  chainId: string;
  /** Maximum gas price (in gwei) the relayer will accept */
  maxGasPriceGwei: number;
  /** Fee percentage charged by relayer */
  feePercentage: number;
}

export interface RelayerRequest {
  /** Original transaction to relay */
  transaction: RelayerTransaction;
  /** Sender address (who will pay the relayer fee) */
  senderAddress: string;
  /** Maximum fee the sender is willing to pay (in wei) */
  maxFeeWei: string;
}

export interface RelayerTransaction {
  from: string;
  to: string;
  value: string;
  data: string;
  chainId: number;
}

export interface RelayerResult {
  /** Whether the relayer accepted the transaction */
  accepted: boolean;
  /** Relayer's transaction hash */
  relayerTxHash: string;
  /** Original transaction hash (after relay) */
  originalTxHash: string;
  /** Fee charged by relayer (in wei) */
  feeWei: string;
  /** Estimated time to confirmation (seconds) */
  estimatedConfirmationTime: number;
}

// ─── Gas Cost Estimation ──────────────────────────────────────────────────

export interface GasCostEstimate {
  /** Chain ID */
  chainId: string;
  /** Gas abstraction strategy for this chain */
  strategy: GasAbstractionStrategy;
  /** Estimated gas cost in native token */
  nativeCost: number;
  /** Native token symbol (ETH, TRX, SOL) */
  nativeSymbol: string;
  /** Estimated gas cost in USD */
  usdCost: number;
  /** If paying with ERC-20, the cost in that token */
  tokenCost?: number;
  /** Token symbol if paying with ERC-20 */
  tokenSymbol?: string;
  /** Gas limit */
  gasLimit: number;
  /** Gas price (gwei for EVM, lamports for Solana, sun for Tron) */
  gasPrice: number;
  /** Whether gasless is available for this transaction */
  gaslessAvailable: boolean;
  /** Paymaster/relayer fee if gasless */
  gaslessFee?: GaslessFee;
}

export interface GaslessFee {
  /** Fee percentage (e.g., 0.5 = 0.5%) */
  percentage: number;
  /** Fee in USD */
  usdAmount: number;
  /** Fee in the payment token */
  tokenAmount: number;
  /** Payment token symbol */
  tokenSymbol: string;
}

// ─── Gas Abstraction Interface ────────────────────────────────────────────

export interface IGasAbstraction {
  /**
   * Get the gas abstraction strategy for a chain.
   */
  getStrategy(chainId: string): GasAbstractionStrategy;

  /**
   * Estimate gas cost for a transaction.
   */
  estimateGasCost(params: {
    chainId: string;
    from: string;
    to: string;
    value: string;
    data: string;
    gasToken?: string;
  }): Promise<GasCostEstimate>;

  /**
   * Check if gasless is available for a transaction.
   */
  isGaslessAvailable(chainId: string, token?: string): Promise<boolean>;

  /**
   * Prepare a gasless transaction (paymaster or relayer).
   */
  prepareGasless(params: {
    chainId: string;
    transaction: RelayerTransaction;
    senderAddress: string;
    gasToken?: string;
  }): Promise<PaymasterRequest | RelayerRequest>;

  /**
   * Execute a gasless transaction.
   */
  executeGasless(params: {
    chainId: string;
    preparedRequest: PaymasterRequest | RelayerRequest;
  }): Promise<GaslessExecutionResult>;
}

export interface GaslessExecutionResult {
  /** Whether the transaction was successful */
  success: boolean;
  /** Transaction hash */
  txHash: string;
  /** Gas cost (if not gasless) or fee (if gasless) */
  cost: GasCostEstimate;
  /** Error message if failed */
  error?: string;
}
