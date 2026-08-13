/**
 * Chain-specific error classes.
 * Granular errors for chain client operations.
 */

import { GatewayError } from './gateway-error.js';

// ─── Address Errors ─────────────────────────────────────────────────────────

export class InvalidAddressError extends GatewayError {
  constructor(address: string, chain: string) {
    super(
      'INVALID_ADDRESS',
      `Invalid address "${address}" for chain ${chain}`,
      400,
      { address, chain },
    );
  }
}

// ─── Gas Errors ─────────────────────────────────────────────────────────────

export class InsufficientGasError extends GatewayError {
  constructor(chain: string, required: string, available: string) {
    super(
      'INSUFFICIENT_GAS',
      `Insufficient gas on ${chain}: need ${required}, have ${available}`,
      500,
      { chain, required, available },
    );
  }
}

// ─── RPC Errors ─────────────────────────────────────────────────────────────

export class RpcError extends GatewayError {
  public readonly rpcCode: number;
  public readonly rpcData?: unknown;

  constructor(chain: string, rpcCode: number, message: string, data?: unknown) {
    super(
      'RPC_ERROR',
      `RPC error on ${chain}: [${rpcCode}] ${message}`,
      502,
      { chain, rpcCode, data },
    );
    this.rpcCode = rpcCode;
    this.rpcData = data;
  }
}

// ─── Reorg Errors ───────────────────────────────────────────────────────────

export class ReorgDetectedError extends GatewayError {
  constructor(chain: string, txHash: string, forkBlock: number) {
    super(
      'REORG_DETECTED',
      `Chain reorganization detected on ${chain} at block ${forkBlock}`,
      500,
      { chain, txHash, forkBlock },
    );
  }
}

// ─── Transaction Errors ─────────────────────────────────────────────────────

export class TransactionRevertedError extends GatewayError {
  public readonly txHash: string;
  public readonly revertReason?: string;

  constructor(txHash: string, chain: string, revertReason?: string) {
    super(
      'TRANSACTION_REVERTED',
      `Transaction ${txHash} reverted on ${chain}${revertReason ? `: ${revertReason}` : ''}`,
      500,
      { txHash, chain, revertReason },
    );
    this.txHash = txHash;
    this.revertReason = revertReason;
  }
}

// ─── Balance Errors ─────────────────────────────────────────────────────────

export class BalanceQueryError extends GatewayError {
  constructor(address: string, chain: string, reason?: string) {
    super(
      'BALANCE_QUERY_FAILED',
      `Failed to query balance for ${address} on ${chain}${reason ? `: ${reason}` : ''}`,
      502,
      { address, chain, reason },
    );
  }
}

// ─── Watcher Errors ─────────────────────────────────────────────────────────

export class DepositWatcherError extends GatewayError {
  constructor(address: string, chain: string, reason?: string) {
    super(
      'DEPOSIT_WATCHER_ERROR',
      `Deposit watcher failed for ${address} on ${chain}${reason ? `: ${reason}` : ''}`,
      500,
      { address, chain, reason },
    );
  }
}
