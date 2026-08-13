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
 * Tron chain configuration.
 */
interface TronChainConfig {
  chainId: string;
  chainName: string;
  rpcUrl: string;
  confirmationDepth: number;
  blockTime: number;
  energyPriceSun: number;
  bandwidthPriceSun: number;
}

const DEFAULT_TRON_CONFIG: TronChainConfig = {
  chainId: 'tron',
  chainName: 'Tron',
  rpcUrl: 'https://api.trongrid.io',
  confirmationDepth: 19,
  blockTime: 3,
  energyPriceSun: 420, // ~0.00042 TRX per energy
  bandwidthPriceSun: 1000, // ~0.001 TRX per bandwidth
};

/**
 * TronChainClient
 *
 * Implements the IChainClient interface for the Tron blockchain.
 * Supports:
 * - TRX native transfers
 * - TRC20 token transfers (USDT, USDC, etc.)
 * - Energy/Bandwidth resource model
 * - 19-block finality
 * - Event polling for deposit monitoring
 *
 * Tron addresses use Base58Check encoding and start with 'T'.
 */
export class TronChainClient implements IChainClient {
  readonly chainId: string;
  readonly chainName: string;

  private readonly config: TronChainConfig;
  private readonly watchers: Map<string, ReturnType<typeof setInterval>> = new Map();

  constructor(config?: Partial<TronChainConfig>) {
    this.config = { ...DEFAULT_TRON_CONFIG, ...config };
    this.chainId = this.config.chainId;
    this.chainName = this.config.chainName;
  }

  // ─── Chain Info ──────────────────────────────────────────────────────

  getConfirmationDepth(): number {
    return this.config.confirmationDepth;
  }

  getBlockTime(): number {
    return this.config.blockTime;
  }

  getNativeAsset(): AssetInfo {
    return {
      address: '0x0000000000000000000000000000000000000000',
      symbol: 'TRX',
      decimals: 6,
      name: 'TRON',
    };
  }

  // ─── Address Operations ─────────────────────────────────────────────

  /**
   * Validate a Tron address.
   * Tron addresses are Base58Check encoded and start with 'T'.
   * They are 34 characters long.
   */
  validateAddress(address: string): boolean {
    if (!address || typeof address !== 'string') return false;

    // Tron addresses start with 'T' and are 34 characters
    // Base58Check encoding: starts with T (0x41 prefix), 34 chars total
    if (address.length !== 34) return false;
    if (address[0] !== 'T') return false;

    // Base58 validation: alphanumeric excluding 0, O, I, l
    const base58Chars = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    for (let i = 1; i < address.length; i++) {
      if (!base58Chars.includes(address[i]!)) return false;
    }

    return true;
  }

  /**
   * Format a Tron address (return as-is, Tron addresses are already checksummed).
   */
  formatAddress(address: string): string {
    if (!this.validateAddress(address)) {
      throw new InvalidAddressError(address, this.chainName);
    }
    return address;
  }

  // ─── Transaction Operations ─────────────────────────────────────────

  /**
   * Estimate gas (energy + bandwidth) for a transaction.
   * Tron uses energy for smart contract calls and bandwidth for basic transfers.
   */
  async estimateGas(tx: UnsignedTx): Promise<GasEstimate> {
    const isContractCall = tx.data !== '0x' && tx.data !== '';

    // Estimate energy for contract calls, bandwidth for simple transfers
    const energyRequired = isContractCall ? 65000 : 0;
    const bandwidthRequired = isContractCall ? 350 : 250;

    const energyCostSun = energyRequired * this.config.energyPriceSun;
    const bandwidthCostSun = bandwidthRequired * this.config.bandwidthPriceSun;
    const totalCostSun = energyCostSun + bandwidthCostSun;
    const totalCostTrx = totalCostSun / 1_000_000;

    // TRX price estimate (in production, fetch from oracle)
    const trxPriceUsd = 0.12;
    const totalCostUsd = totalCostTrx * trxPriceUsd;

    return {
      gasLimit: energyRequired + bandwidthRequired,
      gasPrice: this.config.energyPriceSun,
      totalCost: totalCostTrx,
      totalCostUSD: totalCostUsd,
    };
  }

  /**
   * Submit a signed transaction to the Tron network.
   * In production, this would broadcast via the TronGrid API.
   */
  async submitTransaction(_tx: SignedTx): Promise<TxResult> {
    // In production, this would:
    // 1. Parse the signed transaction
    // 2. Broadcast via tronWeb.trx.sendRawTransaction()
    // 3. Return the transaction ID

    // Simulate transaction submission
    const txHash = this.generateTxHash();

    return {
      txHash,
      nonce: 0,
      blockNumber: 0,
    };
  }

  /**
   * Get the status of a transaction.
   * Tron uses 19-block finality.
   */
  async getTransactionStatus(txHash: string): Promise<TxStatus> {
    // In production, this would query the TronGrid API
    // For now, simulate based on block confirmation

    // Simulate: assume confirmed after some blocks
    return {
      txHash,
      status: 'CONFIRMED',
      confirmations: this.config.confirmationDepth,
      blockNumber: 1000000,
      gasUsed: 65000,
    };
  }

  /**
   * Get the receipt of a transaction.
   */
  async getTransactionReceipt(txHash: string): Promise<TxReceipt> {
    // In production, this would query tronWeb.trx.getTransactionReceipt()
    return {
      txHash,
      status: true,
      blockNumber: 1000000,
      blockHash: this.generateBlockHash(),
      gasUsed: 65000,
      effectiveGasPrice: this.config.energyPriceSun,
      logs: [],
    };
  }

  // ─── Balance Operations ─────────────────────────────────────────────

  /**
   * Get the balance of TRX or TRC20 tokens.
   */
  async getBalance(address: string, asset: AssetInfo): Promise<Balance> {
    if (asset.symbol === 'TRX') {
      // Native TRX balance
      // In production: await tronWeb.trx.getBalance(address)
      return {
        asset,
        amount: '1000000', // 1 TRX in sun
        amountUSD: 0.12,
      };
    }

    // TRC20 token balance
    return this.getTokenBalance(address, asset.address);
  }

  /**
   * Get TRC20 token balance.
   * Uses the `balanceOf` method on the TRC20 contract.
   */
  async getTokenBalance(_address: string, tokenAddress: string): Promise<Balance> {
    // In production, this would:
    // 1. Get the TRC20 contract instance
    // 2. Call balanceOf(address)
    // 3. Get decimals from the contract

    const asset: AssetInfo = {
      address: tokenAddress,
      symbol: this.getTokenSymbol(tokenAddress),
      decimals: this.getTokenDecimals(tokenAddress),
      name: this.getTokenName(tokenAddress),
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
   * Uses event polling since Tron doesn't have WebSocket support for all nodes.
   */
  watchDeposits(
    address: string,
    onDeposit: (tx: DepositEvent) => void,
  ): Unsubscribe {
    const watcherId = `watcher-${address}-${Date.now()}`;

    // Poll for new transactions every block time
    const interval = setInterval(async () => {
      try {
        const events = await this.pollDeposits(address);
        for (const event of events) {
          onDeposit(event);
        }
      } catch {
        // Log error but don't crash the watcher
        console.error(`Deposit watcher error for ${address}`);
      }
    }, this.config.blockTime * 1000);

    this.watchers.set(watcherId, interval);

    // Return unsubscribe function
    return () => {
      const watcherInterval = this.watchers.get(watcherId);
      if (watcherInterval) {
        clearInterval(watcherInterval);
        this.watchers.delete(watcherId);
      }
    };
  }

  // ─── Tron-Specific Methods ──────────────────────────────────────────

  /**
   * Get energy and bandwidth price in SUN.
   */
  getResourcePrices(): { energyPriceSun: number; bandwidthPriceSun: number } {
    return {
      energyPriceSun: this.config.energyPriceSun,
      bandwidthPriceSun: this.config.bandwidthPriceSun,
    };
  }

  /**
   * Calculate the energy cost for a TRC20 transfer.
   * Typical TRC20 transfer costs ~65,000 energy.
   */
  calculateTrc20TransferCost(_amount: number): {
    energyRequired: number;
    costTrx: number;
    costUsd: number;
  } {
    const energyRequired = 65000; // Standard TRC20 transfer
    const costSun = energyRequired * this.config.energyPriceSun;
    const costTrx = costSun / 1_000_000;
    const costUsd = costTrx * 0.12; // TRX price estimate

    return { energyRequired, costTrx, costUsd };
  }

  /**
   * Check if an address is a known TRC20 contract.
   */
  isTrc20Contract(address: string): boolean {
    // In production, check if the address has contract code
    // For now, check if it's 42 characters (0x prefix) which indicates a contract
    return /^0x[0-9a-fA-F]{40}$/.test(address);
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
    // In production, this would:
    // 1. Query account transactions from TronGrid
    // 2. Filter for incoming transfers
    // 3. Check confirmation depth

    // Simulate: return empty array (no new deposits)
    return [];
  }

  /**
   * Generate a mock transaction hash.
   */
  private generateTxHash(): string {
    const chars = '0123456789abcdef';
    let hash = '0x';
    for (let i = 0; i < 64; i++) {
      hash += chars[Math.floor(Math.random() * chars.length)];
    }
    return hash;
  }

  /**
   * Generate a mock block hash.
   */
  private generateBlockHash(): string {
    return this.generateTxHash();
  }

  /**
   * Get token symbol from address (mock mapping).
   */
  private getTokenSymbol(address: string): string {
    const knownTokens: Record<string, string> = {
      'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t': 'USDT',
      'TEkxiTtzS2xTE8jTydcY52gLDjCXR7Mb4a': 'USDC',
    };
    return knownTokens[address] ?? 'UNKNOWN';
  }

  /**
   * Get token decimals from address (mock mapping).
   */
  private getTokenDecimals(address: string): number {
    const knownDecimals: Record<string, number> = {
      'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t': 6,
      'TEkxiTtzS2xTE8jTydcY52gLDjCXR7Mb4a': 6,
    };
    return knownDecimals[address] ?? 18;
  }

  /**
   * Get token name from address (mock mapping).
   */
  private getTokenName(address: string): string {
    const knownNames: Record<string, string> = {
      'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t': 'Tether USD',
      'TEkxiTtzS2xTE8jTydcY52gLDjCXR7Mb4a': 'USD Coin',
    };
    return knownNames[address] ?? 'Unknown Token';
  }
}
