/**
 * Chain Abstraction Layer
 * Unified interface for all chain interactions.
 */

// ─── Re-export shared types ─────────────────────────────────────────────────
export type {
  IChainClient,
  AssetInfo,
  UnsignedTx,
  SignedTx,
  GasEstimate,
  TxResult,
  TxStatus,
  TxReceipt,
  TxLog,
  DepositEvent,
  Balance,
  Unsubscribe,
  ChainConfig,
  ChainId,
} from '@crypto-gateway/shared';

export {
  CHAIN_IDS,
  DEFAULT_CHAIN_CONFIGS,
} from '@crypto-gateway/shared';

// ─── Chain Client Implementations ───────────────────────────────────────────
export { EVMChainClient } from './evm/evm-chain-client.js';
export { TronChainClient } from './tron/tron-chain-client.js';
export { SolanaChainClient } from './solana/solana-chain-client.js';

// ─── Chain Registry ─────────────────────────────────────────────────────────
export { ChainRegistry } from './chain-registry.js';
