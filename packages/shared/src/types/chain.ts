/**
 * Chain Abstraction Types
 * Unified interfaces for all chain interactions.
 */

// ─── Asset ───────────────────────────────────────────────────────────────────

export interface AssetInfo {
  address: string;
  symbol: string;
  decimals: number;
  name: string;
}

// ─── Transaction Types ───────────────────────────────────────────────────────

export interface UnsignedTx {
  from: string;
  to: string;
  value: string;
  data: string;
  chainId?: number;
}

export interface SignedTx {
  signedData: string;
}

export interface GasEstimate {
  gasLimit: number;
  gasPrice: number;
  maxFeePerGas?: number;
  maxPriorityFeePerGas?: number;
  totalCost: number;
  totalCostUSD: number;
}

export interface TxResult {
  txHash: string;
  nonce?: number;
  blockNumber?: number;
}

export type TxStatusState = 'PENDING' | 'CONFIRMING' | 'CONFIRMED' | 'FAILED';

export interface TxStatus {
  txHash: string;
  status: TxStatusState;
  confirmations: number;
  blockNumber?: number;
  gasUsed?: number;
  effectiveGasPrice?: number;
}

export interface TxReceipt {
  txHash: string;
  status: boolean;
  blockNumber: number;
  blockHash: string;
  gasUsed: number;
  effectiveGasPrice: number;
  logs: TxLog[];
}

export interface TxLog {
  address: string;
  topics: string[];
  data: string;
  blockNumber: number;
  txHash: string;
  logIndex: number;
}

// ─── Balance ─────────────────────────────────────────────────────────────────

export interface Balance {
  asset: AssetInfo;
  amount: string;
  amountUSD: number;
}

// ─── Deposit ─────────────────────────────────────────────────────────────────

export interface DepositEvent {
  txHash: string;
  blockNumber: number;
  from: string;
  to: string;
  asset: AssetInfo;
  amount: string;
  confirmations: number;
}

// ─── Chain Client Interface ──────────────────────────────────────────────────

export type Unsubscribe = () => void;

export interface IChainClient {
  chainId: string;
  chainName: string;

  // Chain Info
  getConfirmationDepth(): number;
  getBlockTime(): number;
  getNativeAsset(): AssetInfo;

  // Address Operations
  validateAddress(address: string): boolean;
  formatAddress(address: string): string;

  // Transaction Operations
  estimateGas(tx: UnsignedTx): Promise<GasEstimate>;
  submitTransaction(tx: SignedTx): Promise<TxResult>;
  getTransactionStatus(txHash: string): Promise<TxStatus>;
  getTransactionReceipt(txHash: string): Promise<TxReceipt>;

  // Balance Operations
  getBalance(address: string, asset: AssetInfo): Promise<Balance>;
  getTokenBalance(address: string, tokenAddress: string): Promise<Balance>;

  // Deposit Monitoring
  watchDeposits(
    address: string,
    onDeposit: (tx: DepositEvent) => void,
  ): Unsubscribe;
}
