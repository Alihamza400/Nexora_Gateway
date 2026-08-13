/**
 * EVM Chain Client
 * Production-grade implementation of IChainClient for EVM-compatible chains.
 * Uses ethers.js v6 for all RPC interactions.
 */

import { ethers, JsonRpcProvider, Contract } from 'ethers';
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
  ChainConfig,
} from '@crypto-gateway/shared';
import {
  InvalidAddressError,
  TransactionRevertedError,
  BalanceQueryError,
  RpcError,
} from '@crypto-gateway/shared';
import { ERC20_ABI, TRANSFER_TOPIC } from '@crypto-gateway/shared';

// ─── Default config per chain ───────────────────────────────────────────────

const DEFAULT_CONFIGS: Record<string, Partial<ChainConfig>> = {
  '1': { confirmationDepth: 12, blockTime: 12, supportsEIP1559: true },
  '11155111': { confirmationDepth: 12, blockTime: 12, supportsEIP1559: true },
  '8453': { confirmationDepth: 1, blockTime: 2, supportsEIP1559: true },
  '84532': { confirmationDepth: 1, blockTime: 2, supportsEIP1559: true },
  '42161': { confirmationDepth: 1, blockTime: 0.25, supportsEIP1559: true },
  '421614': { confirmationDepth: 1, blockTime: 0.25, supportsEIP1559: true },
  '137': { confirmationDepth: 128, blockTime: 2, supportsEIP1559: true },
  '80002': { confirmationDepth: 128, blockTime: 2, supportsEIP1559: true },
  '10': { confirmationDepth: 1, blockTime: 2, supportsEIP1559: true },
  '11155420': { confirmationDepth: 1, blockTime: 2, supportsEIP1559: true },
};

// ─── Native asset mapping ───────────────────────────────────────────────────

const NATIVE_ASSETS: Record<string, AssetInfo> = {
  '1': { address: ethers.ZeroAddress, symbol: 'ETH', decimals: 18, name: 'Ether' },
  '11155111': { address: ethers.ZeroAddress, symbol: 'ETH', decimals: 18, name: 'Sepolia ETH' },
  '8453': { address: ethers.ZeroAddress, symbol: 'ETH', decimals: 18, name: 'Ether' },
  '84532': { address: ethers.ZeroAddress, symbol: 'ETH', decimals: 18, name: 'Base Sepolia ETH' },
  '42161': { address: ethers.ZeroAddress, symbol: 'ETH', decimals: 18, name: 'Ether' },
  '421614': { address: ethers.ZeroAddress, symbol: 'ETH', decimals: 18, name: 'Arbitrum Sepolia ETH' },
  '137': { address: ethers.ZeroAddress, symbol: 'POL', decimals: 18, name: 'POL' },
  '80002': { address: ethers.ZeroAddress, symbol: 'POL', decimals: 18, name: 'POL' },
  '10': { address: ethers.ZeroAddress, symbol: 'ETH', decimals: 18, name: 'Ether' },
  '11155420': { address: ethers.ZeroAddress, symbol: 'ETH', decimals: 18, name: 'Optimism Sepolia ETH' },
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function wrapRpcError(chainId: string, error: unknown): never {
  const err = error as { code?: number; message?: string; data?: unknown };
  if (err?.code) {
    throw new RpcError(chainId, err.code, err.message || 'Unknown RPC error', err.data);
  }
  throw error;
}

// ─── EVMChainClient ─────────────────────────────────────────────────────────

export class EVMChainClient implements IChainClient {
  public readonly chainId: string;
  public readonly chainName: string;
  private readonly provider: JsonRpcProvider;
  private readonly config: ChainConfig;
  private readonly watchedAddresses: Map<string, Set<(tx: DepositEvent) => void>> = new Map();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private lastBlockNumber: number = 0;

  constructor(
    chainId: string,
    chainName: string,
    rpcUrl: string,
    options: {
      confirmationDepth?: number;
      blockTime?: number;
      supportsEIP1559?: boolean;
      /** Price oracle: native asset symbol → USD price */
      priceOracle?: () => Promise<number>;
    } = {},
  ) {
    this.chainId = chainId;
    this.chainName = chainName;

    const defaults = DEFAULT_CONFIGS[chainId] || {};
    this.config = {
      chainId,
      chainName,
      rpcUrl,
      confirmationDepth: options.confirmationDepth ?? defaults.confirmationDepth ?? 12,
      blockTime: options.blockTime ?? defaults.blockTime ?? 12,
      nativeAsset: NATIVE_ASSETS[chainId] || {
        address: ethers.ZeroAddress,
        symbol: 'UNKNOWN',
        decimals: 18,
        name: 'Unknown',
      },
      explorerUrl: '',
      supportsEIP1559: options.supportsEIP1559 ?? defaults.supportsEIP1559 ?? true,
      supportsAccountAbstraction: false,
    };

    this.provider = new JsonRpcProvider(rpcUrl);
  }

  // ─── Chain Info ─────────────────────────────────────────────────────────

  getConfirmationDepth(): number {
    return this.config.confirmationDepth;
  }

  getBlockTime(): number {
    return this.config.blockTime;
  }

  getNativeAsset(): AssetInfo {
    return this.config.nativeAsset;
  }

  // ─── Address Operations ─────────────────────────────────────────────────

  validateAddress(address: string): boolean {
    try {
      return ethers.isAddress(address);
    } catch {
      return false;
    }
  }

  formatAddress(address: string): string {
    if (!this.validateAddress(address)) {
      throw new InvalidAddressError(address, this.chainId);
    }
    return ethers.getAddress(address);
  }

  // ─── Transaction Operations ─────────────────────────────────────────────

  async estimateGas(tx: UnsignedTx): Promise<GasEstimate> {
    try {
      const [gasLimit, feeData] = await Promise.all([
        this.provider.estimateGas({
          from: tx.from,
          to: tx.to,
          value: tx.value === '0' ? 0n : BigInt(tx.value),
          data: tx.data || '0x',
        }),
        this.provider.getFeeData(),
      ]);

      const gasPrice = feeData.gasPrice ?? 0n;
      const maxFeePerGas = feeData.maxFeePerGas ?? undefined;
      const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas ?? undefined;

      // Use EIP-1559 if available, otherwise legacy gas price
      const effectiveGasPrice = maxFeePerGas ?? gasPrice;
      const totalCost = gasLimit * effectiveGasPrice;
      const totalCostETH = parseFloat(ethers.formatEther(totalCost));

      // Price oracle (optional, default to 0 USD)
      let totalCostUSD = 0;
      try {
        // Attempt to get price — graceful degradation if oracle unavailable
        totalCostUSD = totalCostETH * 0; // Placeholder — real oracle integration in Phase 3
      } catch {
        // Price oracle unavailable — return 0 USD, don't fail the estimate
      }

      return {
        gasLimit: Number(gasLimit),
        gasPrice: Number(gasPrice),
        maxFeePerGas: maxFeePerGas ? Number(maxFeePerGas) : undefined,
        maxPriorityFeePerGas: maxPriorityFeePerGas ? Number(maxPriorityFeePerGas) : undefined,
        totalCost: Number(totalCost),
        totalCostUSD,
      };
    } catch (error) {
      wrapRpcError(this.chainId, error);
    }
  }

  async submitTransaction(tx: SignedTx): Promise<TxResult> {
    try {
      const response = await this.provider.broadcastTransaction(tx.signedData);
      return {
        txHash: response.hash,
        nonce: response.nonce,
        blockNumber: response.blockNumber ?? undefined,
      };
    } catch (error) {
      wrapRpcError(this.chainId, error);
    }
  }

  async getTransactionStatus(txHash: string): Promise<TxStatus> {
    try {
      const [tx, receipt] = await Promise.all([
        this.provider.getTransaction(txHash),
        this.provider.getTransactionReceipt(txHash),
      ]);

      if (!tx && !receipt) {
        return { txHash, status: 'PENDING', confirmations: 0 };
      }

      if (!receipt) {
        return { txHash, status: 'PENDING', confirmations: 0 };
      }

      const currentBlock = await this.provider.getBlockNumber();
      const confirmations = currentBlock - receipt.blockNumber;

      let status: TxStatus['status'];
      if (!receipt.status) {
        status = 'FAILED';
      } else if (confirmations < this.config.confirmationDepth) {
        status = 'CONFIRMING';
      } else {
        status = 'CONFIRMED';
      }

      return {
        txHash,
        status,
        confirmations,
        blockNumber: receipt.blockNumber,
        gasUsed: Number(receipt.gasUsed),
        effectiveGasPrice: Number(receipt.gasPrice),
      };
    } catch (error) {
      wrapRpcError(this.chainId, error);
    }
  }

  async getTransactionReceipt(txHash: string): Promise<TxReceipt> {
    try {
      const receipt = await this.provider.getTransactionReceipt(txHash);
      if (!receipt) {
        throw new TransactionRevertedError(txHash, this.chainId, 'Receipt not found');
      }

      return {
        txHash,
        status: receipt.status === 1,
        blockNumber: receipt.blockNumber,
        blockHash: receipt.blockHash,
        gasUsed: Number(receipt.gasUsed),
        effectiveGasPrice: Number(receipt.gasPrice),
        logs: receipt.logs.map((log) => ({
          address: log.address,
          topics: Array.from(log.topics),
          data: log.data,
          blockNumber: log.blockNumber,
          txHash: log.transactionHash,
          logIndex: log.index,
        })),
      };
    } catch (error) {
      if (error instanceof TransactionRevertedError) throw error;
      wrapRpcError(this.chainId, error);
    }
  }

  // ─── Balance Operations ─────────────────────────────────────────────────

  async getBalance(address: string, asset: AssetInfo): Promise<Balance> {
    try {
      if (asset.address === ethers.ZeroAddress || asset.address === '') {
        // Native asset
        const balance = await this.provider.getBalance(address);
        return {
          asset,
          amount: balance.toString(),
          amountUSD: 0, // Phase 3: price oracle
        };
      }

      // ERC-20 token
      return this.getTokenBalance(address, asset.address);
    } catch (error) {
      throw new BalanceQueryError(address, this.chainId, (error as Error).message);
    }
  }

  async getTokenBalance(address: string, tokenAddress: string): Promise<Balance> {
    try {
      const contract = new Contract(tokenAddress, ERC20_ABI, this.provider);

      /* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
      const rawBalance: bigint = await (contract as any).balanceOf(address);
      const decimals: number = await (contract as any).decimals();
      const symbol: string = await (contract as any).symbol();
      const name: string = await (contract as any).name();
      /* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */

      const asset: AssetInfo = {
        address: this.formatAddress(tokenAddress),
        symbol,
        decimals,
        name,
      };

      return {
        asset,
        amount: rawBalance.toString(),
        amountUSD: 0, // Phase 3: price oracle
      };
    } catch (error) {
      throw new BalanceQueryError(address, this.chainId, (error as Error).message);
    }
  }

  // ─── Deposit Monitoring ─────────────────────────────────────────────────

  watchDeposits(address: string, onDeposit: (tx: DepositEvent) => void): Unsubscribe {
    const normalizedAddress = address.toLowerCase();

    // Register listener
    if (!this.watchedAddresses.has(normalizedAddress)) {
      this.watchedAddresses.set(normalizedAddress, new Set());
    }
    this.watchedAddresses.get(normalizedAddress)!.add(onDeposit);

    // Start polling if not already running
    if (!this.pollTimer) {
      void this.startPolling();
    }

    // Return unsubscribe function
    return () => {
      const listeners = this.watchedAddresses.get(normalizedAddress);
      if (listeners) {
        listeners.delete(onDeposit);
        if (listeners.size === 0) {
          this.watchedAddresses.delete(normalizedAddress);
        }
      }
      // Stop polling if no more listeners
      if (this.watchedAddresses.size === 0 && this.pollTimer) {
        clearInterval(this.pollTimer);
        this.pollTimer = null;
      }
    };
  }

  // ─── Private: Polling Loop ──────────────────────────────────────────────

  private async startPolling(): Promise<void> {
    try {
      this.lastBlockNumber = await this.provider.getBlockNumber();
    } catch {
      // Will retry on next poll
    }

    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    this.pollTimer = setInterval(async () => {
      try {
        await this.pollBlocks();
      } catch {
        // Log error but don't crash the polling loop
      }
    }, this.config.blockTime * 1000);
  }

  private async pollBlocks(): Promise<void> {
    const currentBlock = await this.provider.getBlockNumber();
    if (currentBlock <= this.lastBlockNumber) return;

    for (let blockNum = this.lastBlockNumber + 1; blockNum <= currentBlock; blockNum++) {
      const block = await this.provider.getBlock(blockNum, true);
      if (!block || !block.transactions) continue;

      for (const txHash of block.transactions) {
        const tx = await this.provider.getTransaction(String(txHash));
        if (!tx) continue;

        const toAddress = tx.to?.toLowerCase();
        const fromAddress = tx.from?.toLowerCase();

        // Check if this tx involves any watched address
        for (const [watchedAddr, addrListeners] of this.watchedAddresses.entries()) {
          if (toAddress === watchedAddr || fromAddress === watchedAddr) {
            const confirmations = currentBlock - blockNum + 1;
            const nativeAsset = this.getNativeAsset();

            const event: DepositEvent = {
              txHash: tx.hash,
              blockNumber: blockNum,
              from: tx.from,
              to: tx.to ?? ethers.ZeroAddress,
              asset: nativeAsset,
              amount: tx.value.toString(),
              confirmations,
            };

            // eslint-disable-next-line @typescript-eslint/no-misused-promises
            for (const listener of addrListeners) {
              try {
                listener(event);
              } catch {
                // Don't let listener errors break the loop
              }
            }
          }
        }

        // Also check ERC-20 Transfer logs in the receipt
        const receipt = await this.provider.getTransactionReceipt(String(txHash));
        if (receipt) {
          for (const log of receipt.logs) {
            if (log.topics.length >= 3 && log.topics[0] === TRANSFER_TOPIC) {
              const toTopic = '0x' + (log.topics[2] ?? '').slice(26).toLowerCase();
              for (const [watchedAddr, erc20Listeners] of this.watchedAddresses.entries()) {
                if (toTopic === watchedAddr) {
                  const confirmations = currentBlock - blockNum + 1;
                  const decoded = ethers.AbiCoder.defaultAbiCoder().decode(
                    ['uint256'],
                    log.data,
                  );
                  const amount: bigint = decoded.length > 0 ? decoded[0] : 0n; // eslint-disable-line @typescript-eslint/no-unsafe-assignment

                  const event: DepositEvent = {
                    txHash: receipt.hash,
                    blockNumber: blockNum,
                    from: '0x' + (log.topics[1] ?? '').slice(26),
                    to: toTopic,
                    asset: {
                      address: log.address,
                      symbol: 'UNKNOWN', // Will be enriched later
                      decimals: 18,
                      name: 'Unknown Token',
                    },
                    amount: amount.toString(),
                    confirmations,
                  };

                  for (const listener of erc20Listeners) {
                    try {
                      listener(event);
                    } catch {
                      // Don't let listener errors break the loop
                    }
                  }
                }
              }
            }
          }
        }
      }
    }

    this.lastBlockNumber = currentBlock;
  }

  // ─── Cleanup ────────────────────────────────────────────────────────────

  destroy(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.watchedAddresses.clear();
  }
}
