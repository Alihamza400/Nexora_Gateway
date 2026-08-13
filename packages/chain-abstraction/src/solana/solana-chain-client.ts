import type {
  IChainClient,
  AssetInfo,
  UnsignedTx,
  SignedTx,
  GasEstimate,
  TxResult,
  TxStatus,
  TxReceipt,
  Balance,
  DepositEvent,
  Unsubscribe,
} from '@crypto-gateway/shared';
import { InvalidAddressError } from '@crypto-gateway/shared';

/**
 * Solana chain configuration.
 */
interface SolanaChainConfig {
  chainId: string;
  chainName: string;
  rpcUrl: string;
  wsUrl: string;
  confirmationDepth: number;
  slotTime: number; // seconds per slot
  computeUnitPrice: number; // micro-lamports per compute unit
}

const DEFAULT_SOLANA_CONFIG: SolanaChainConfig = {
  chainId: 'solana',
  chainName: 'Solana',
  rpcUrl: 'https://api.mainnet-beta.solana.com',
  wsUrl: 'wss://api.mainnet-beta.solana.com',
  confirmationDepth: 32,
  slotTime: 0.4,
  computeUnitPrice: 1, // 1 micro-lamport per compute unit
};

/**
 * SolanaChainClient
 *
 * Implements the IChainClient interface for the Solana blockchain.
 * Supports:
 * - SOL native transfers
 * - SPL token transfers (USDC, USDT, etc.)
 * - Compute units model (replaces gas)
 * - 32-slot finality
 * - WebSocket-based real-time deposit monitoring
 *
 * Solana addresses are Base58-encoded ed25519 public keys (32-44 chars).
 */
export class SolanaChainClient implements IChainClient {
  readonly chainId: string;
  readonly chainName: string;

  private readonly config: SolanaChainConfig;
  private readonly watchers: Map<string, ReturnType<typeof setInterval>> = new Map();

  constructor(config?: Partial<SolanaChainConfig>) {
    this.config = { ...DEFAULT_SOLANA_CONFIG, ...config };
    this.chainId = this.config.chainId;
    this.chainName = this.config.chainName;
  }

  // ─── Chain Info ──────────────────────────────────────────────────────

  getConfirmationDepth(): number {
    return this.config.confirmationDepth;
  }

  getBlockTime(): number {
    return this.config.slotTime;
  }

  getNativeAsset(): AssetInfo {
    return {
      address: '11111111111111111111111111111111', // System Program
      symbol: 'SOL',
      decimals: 9,
      name: 'Solana',
    };
  }

  // ─── Address Operations ─────────────────────────────────────────────

  /**
   * Validate a Solana address.
   * Solana addresses are Base58-encoded ed25519 public keys.
   * They are 32-44 characters long.
   */
  validateAddress(address: string): boolean {
    if (!address || typeof address !== 'string') return false;

    // Solana addresses are 32-44 characters
    if (address.length < 32 || address.length > 44) return false;

    // Base58 validation
    const base58Chars = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    for (const char of address) {
      if (!base58Chars.includes(char)) return false;
    }

    return true;
  }

  /**
   * Format a Solana address (return as-is, Solana addresses are already canonical).
   */
  formatAddress(address: string): string {
    if (!this.validateAddress(address)) {
      throw new InvalidAddressError(address, this.chainName);
    }
    return address;
  }

  // ─── Transaction Operations ─────────────────────────────────────────

  /**
   * Estimate compute units for a transaction.
   * Solana uses compute units instead of gas.
   */
  async estimateGas(tx: UnsignedTx): Promise<GasEstimate> {
    const isTokenTransfer = tx.data !== '0x' && tx.data !== '';

    // Estimate compute units based on transaction type
    const computeUnits = isTokenTransfer ? 200_000 : 5_000;

    // Calculate priority fee in lamports
    const priorityFeeLamports = computeUnits * this.config.computeUnitPrice;
    const priorityFeeSol = priorityFeeLamports / 1_000_000_000;

    // Base transaction fee (5000 lamports)
    const baseFeeLamports = 5000;
    const baseFeeSol = baseFeeLamports / 1_000_000_000;

    const totalCostSol = baseFeeSol + priorityFeeSol;

    // SOL price estimate (in production, fetch from oracle)
    const solPriceUsd = 150;
    const totalCostUsd = totalCostSol * solPriceUsd;

    return {
      gasLimit: computeUnits,
      gasPrice: this.config.computeUnitPrice,
      totalCost: totalCostSol,
      totalCostUSD: totalCostUsd,
    };
  }

  /**
   * Submit a signed transaction to the Solana network.
   * In production, this would send via the JSON-RPC API.
   */
  async submitTransaction(_tx: SignedTx): Promise<TxResult> {
    // In production, this would:
    // 1. Parse the serialized transaction
    // 2. Send via connection.sendRawTransaction()
    // 3. Return the transaction signature

    // Simulate transaction submission
    const txHash = this.generateSignature();

    return {
      txHash,
      nonce: 0,
      blockNumber: 0,
    };
  }

  /**
   * Get the status of a transaction.
   * Solana uses 32-slot finality.
   */
  async getTransactionStatus(txHash: string): Promise<TxStatus> {
    // In production, this would query via connection.getSignatureStatuses()
    return {
      txHash,
      status: 'CONFIRMED',
      confirmations: this.config.confirmationDepth,
      blockNumber: 200000000,
      gasUsed: 5000,
    };
  }

  /**
   * Get the receipt of a transaction.
   */
  async getTransactionReceipt(txHash: string): Promise<TxReceipt> {
    return {
      txHash,
      status: true,
      blockNumber: 200000000,
      blockHash: this.generateSignature(),
      gasUsed: 5000,
      effectiveGasPrice: this.config.computeUnitPrice,
      logs: [],
    };
  }

  // ─── Balance Operations ─────────────────────────────────────────────

  /**
   * Get the balance of SOL or SPL tokens.
   */
  async getBalance(address: string, asset: AssetInfo): Promise<Balance> {
    if (asset.symbol === 'SOL') {
      // Native SOL balance
      // In production: await connection.getBalance(new PublicKey(address))
      return {
        asset,
        amount: '1000000000', // 1 SOL in lamports
        amountUSD: 150,
      };
    }

    // SPL token balance
    return this.getTokenBalance(address, asset.address);
  }

  /**
   * Get SPL token balance.
   * Uses the Token Accounts by Owner method.
   */
  async getTokenBalance(_address: string, mintAddress: string): Promise<Balance> {
    // In production, this would:
    // 1. Get token accounts by owner for the mint
    // 2. Parse the account data
    // 3. Return the balance

    const asset: AssetInfo = {
      address: mintAddress,
      symbol: this.getTokenSymbol(mintAddress),
      decimals: this.getTokenDecimals(mintAddress),
      name: this.getTokenName(mintAddress),
    };

    return {
      asset,
      amount: '1000000', // 1 token (assuming 6 decimals)
      amountUSD: 1.0,
    };
  }

  // ─── Deposit Monitoring ─────────────────────────────────────────────

  /**
   * Watch for deposits to an address.
   * Solana supports WebSocket for real-time event monitoring.
   */
  watchDeposits(
    address: string,
    onDeposit: (tx: DepositEvent) => void,
  ): Unsubscribe {
    const watcherId = `watcher-${address}-${Date.now()}`;

    // In production, this would:
    // 1. Subscribe to logsSubscribe for the address
    // 2. Parse incoming token transfers
    // 3. Emit deposit events

    // Simulate with polling (WebSocket would be used in production)
    const interval = setInterval(async () => {
      try {
        const events = await this.pollDeposits(address);
        for (const event of events) {
          onDeposit(event);
        }
      } catch {
        console.error(`Deposit watcher error for ${address}`);
      }
    }, this.config.slotTime * 1000 * 10); // Poll every 10 slots

    this.watchers.set(watcherId, interval);

    return () => {
      const watcherInterval = this.watchers.get(watcherId);
      if (watcherInterval) {
        clearInterval(watcherInterval);
        this.watchers.delete(watcherId);
      }
    };
  }

  // ─── Solana-Specific Methods ────────────────────────────────────────

  /**
   * Get the current compute unit price.
   */
  getComputeUnitPrice(): number {
    return this.config.computeUnitPrice;
  }

  /**
   * Calculate the priority fee for a transaction.
   */
  calculatePriorityFee(computeUnits: number): {
    computeUnits: number;
    priorityFeeLamports: number;
    priorityFeeSol: number;
    priorityFeeUsd: number;
  } {
    const priorityFeeLamports = computeUnits * this.config.computeUnitPrice;
    const priorityFeeSol = priorityFeeLamports / 1_000_000_000;
    const priorityFeeUsd = priorityFeeSol * 150; // SOL price estimate

    return {
      computeUnits,
      priorityFeeLamports,
      priorityFeeSol,
      priorityFeeUsd,
    };
  }

  /**
   * Check if an address is a system program or associated token program.
   */
  isSystemProgram(address: string): boolean {
    const systemPrograms = [
      '11111111111111111111111111111111', // System Program
      'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', // Token Program
      'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL', // Associated Token Program
    ];
    return systemPrograms.includes(address);
  }

  /**
   * Get recent blockhash (needed for transaction construction).
   */
  async getRecentBlockhash(): Promise<string> {
    // In production: await connection.getRecentBlockhash()
    return this.generateSignature();
  }

  /**
   * Get the current slot (block height).
   */
  async getCurrentSlot(): Promise<number> {
    // In production: await connection.getSlot()
    return 200000000;
  }

  /**
   * Destroy all watchers. Call this on shutdown.
   */
  async destroy(): Promise<void> {
    for (const [id, interval] of this.watchers) {
      clearInterval(interval);
      this.watchers.delete(id);
    }
  }

  // ─── Private Helpers ────────────────────────────────────────────────

  /**
   * Poll for new deposits to an address.
   */
  private async pollDeposits(_address: string): Promise<DepositEvent[]> {
    // In production, this would query recent signatures
    return [];
  }

  /**
   * Generate a mock Solana transaction signature (Base58, 88 chars).
   */
  private generateSignature(): string {
    const base58Chars = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    let sig = '';
    for (let i = 0; i < 88; i++) {
      sig += base58Chars[Math.floor(Math.random() * base58Chars.length)];
    }
    return sig;
  }

  /**
   * Get token symbol from mint address (mock mapping).
   */
  private getTokenSymbol(mintAddress: string): string {
    const knownTokens: Record<string, string> = {
      EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: 'USDC',
      Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: 'USDT',
    };
    return knownTokens[mintAddress] ?? 'UNKNOWN';
  }

  /**
   * Get token decimals from mint address (mock mapping).
   */
  private getTokenDecimals(mintAddress: string): number {
    const knownDecimals: Record<string, number> = {
      EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: 6,
      Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: 6,
    };
    return knownDecimals[mintAddress] ?? 9;
  }

  /**
   * Get token name from mint address (mock mapping).
   */
  private getTokenName(mintAddress: string): string {
    const knownNames: Record<string, string> = {
      EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: 'USD Coin',
      Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: 'Tether USD',
    };
    return knownNames[mintAddress] ?? 'Unknown Token';
  }
}
