/**
 * Chain configuration types and constants.
 * Defines the supported chains and their parameters.
 */

import type { AssetInfo } from './chain.js';

// ─── Chain Configuration ────────────────────────────────────────────────────

export interface ChainConfig {
  chainId: string;
  chainName: string;
  rpcUrl: string;
  confirmationDepth: number;
  blockTime: number;
  nativeAsset: AssetInfo;
  explorerUrl: string;
  /** EIP-1559 support */
  supportsEIP1559: boolean;
  /** Chain supports ERC-4337 account abstraction */
  supportsAccountAbstraction: boolean;
  /** Tron only: energy/bandwidth model */
  usesEnergyBandwidth?: boolean;
}

// ─── Supported Chain Constants ──────────────────────────────────────────────

export const CHAIN_IDS = {
  ETHEREUM: '1',
  SEPOLIA: '11155111',
  BASE: '8453',
  BASE_SEPOLIA: '84532',
  ARBITRUM: '42161',
  ARBITRUM_SEPOLIA: '421614',
  POLYGON: '137',
  POLYGON_AMOY: '80002',
  OPTIMISM: '10',
  OPTIMISM_SEPOLIA: '11155420',
  TRON: 'tron-mainnet',
  TRON_NILE: 'tron-nile',
  SOLANA: 'solana-mainnet',
  SOLANA_DEVNET: 'solana-devnet',
} as const;

export type ChainId = (typeof CHAIN_IDS)[keyof typeof CHAIN_IDS];

// ─── Default Configs (mainnet) ──────────────────────────────────────────────

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

export const DEFAULT_CHAIN_CONFIGS: Record<string, ChainConfig> = {
  [CHAIN_IDS.ETHEREUM]: {
    chainId: CHAIN_IDS.ETHEREUM,
    chainName: 'Ethereum',
    rpcUrl: '', // Filled from env
    confirmationDepth: 12,
    blockTime: 12,
    nativeAsset: { address: ZERO_ADDRESS, symbol: 'ETH', decimals: 18, name: 'Ether' },
    explorerUrl: 'https://etherscan.io',
    supportsEIP1559: true,
    supportsAccountAbstraction: true,
  },
  [CHAIN_IDS.BASE]: {
    chainId: CHAIN_IDS.BASE,
    chainName: 'Base',
    rpcUrl: '',
    confirmationDepth: 1,
    blockTime: 2,
    nativeAsset: { address: ZERO_ADDRESS, symbol: 'ETH', decimals: 18, name: 'Ether' },
    explorerUrl: 'https://basescan.org',
    supportsEIP1559: true,
    supportsAccountAbstraction: true,
  },
  [CHAIN_IDS.ARBITRUM]: {
    chainId: CHAIN_IDS.ARBITRUM,
    chainName: 'Arbitrum One',
    rpcUrl: '',
    confirmationDepth: 1,
    blockTime: 0.25,
    nativeAsset: { address: ZERO_ADDRESS, symbol: 'ETH', decimals: 18, name: 'Ether' },
    explorerUrl: 'https://arbiscan.io',
    supportsEIP1559: true,
    supportsAccountAbstraction: true,
  },
  [CHAIN_IDS.POLYGON]: {
    chainId: CHAIN_IDS.POLYGON,
    chainName: 'Polygon',
    rpcUrl: '',
    confirmationDepth: 128,
    blockTime: 2,
    nativeAsset: { address: ZERO_ADDRESS, symbol: 'POL', decimals: 18, name: 'POL' },
    explorerUrl: 'https://polygonscan.com',
    supportsEIP1559: true,
    supportsAccountAbstraction: true,
  },
  [CHAIN_IDS.OPTIMISM]: {
    chainId: CHAIN_IDS.OPTIMISM,
    chainName: 'Optimism',
    rpcUrl: '',
    confirmationDepth: 1,
    blockTime: 2,
    nativeAsset: { address: ZERO_ADDRESS, symbol: 'ETH', decimals: 18, name: 'Ether' },
    explorerUrl: 'https://optimistic.etherscan.io',
    supportsEIP1559: true,
    supportsAccountAbstraction: true,
  },
  // Testnets
  [CHAIN_IDS.SEPOLIA]: {
    chainId: CHAIN_IDS.SEPOLIA,
    chainName: 'Sepolia',
    rpcUrl: 'https://rpc.sepolia.org',
    confirmationDepth: 12,
    blockTime: 12,
    nativeAsset: { address: ZERO_ADDRESS, symbol: 'ETH', decimals: 18, name: 'Sepolia ETH' },
    explorerUrl: 'https://sepolia.etherscan.io',
    supportsEIP1559: true,
    supportsAccountAbstraction: false,
  },
  [CHAIN_IDS.BASE_SEPOLIA]: {
    chainId: CHAIN_IDS.BASE_SEPOLIA,
    chainName: 'Base Sepolia',
    rpcUrl: 'https://sepolia.base.org',
    confirmationDepth: 1,
    blockTime: 2,
    nativeAsset: { address: ZERO_ADDRESS, symbol: 'ETH', decimals: 18, name: 'Base Sepolia ETH' },
    explorerUrl: 'https://sepolia.basescan.org',
    supportsEIP1559: true,
    supportsAccountAbstraction: false,
  },
};
