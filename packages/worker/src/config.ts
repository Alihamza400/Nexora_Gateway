/**
 * Worker configuration.
 *
 * Loaded once at boot and validated. A missing or malformed value throws
 * immediately rather than surfacing at the first payment, because a worker that
 * starts in a half-configured state will happily accept work it cannot complete.
 */

import { ConfigurationError } from './errors.js';

export type ChainFamily = 'evm' | 'tron' | 'solana';

export interface ChainRuntimeConfig {
  chainId: string;
  chainName: string;
  rpcUrl: string;
  confirmationDepth: number;
  blockTime: number;
  family: ChainFamily;
}

export interface WorkerConfig {
  nodeEnv: string;
  host: string;
  port: number;
  logLevel: string;
  workerId: string;
  pollIntervalMs: number;
  concurrency: number;
  jobMaxAttempts: number;
  jobBackoffBaseMs: number;
  jobBackoffMaxMs: number;
  visibilityTimeoutMs: number;
  watcherRefreshMs: number;
  confirmationCheckMs: number;
  maxWatcherLagBlocks: number;
  chains: ChainRuntimeConfig[];
}

/**
 * Chains the worker knows how to construct.
 *
 * `envKey` is the RPC variable name already used by .env.example and the k8s
 * config. A chain is enabled when its RPC variable is set, so adding a chain is a
 * configuration change rather than a code change.
 */
const KNOWN_CHAINS: ReadonlyArray<{
  chainId: string;
  chainName: string;
  envKey: string;
  depthEnvKey: string;
  defaultDepth: number;
  blockTime: number;
  family: ChainFamily;
}> = [
  {
    chainId: '11155111',
    chainName: 'sepolia',
    envKey: 'ETHEREUM_RPC_URL',
    depthEnvKey: 'ETHEREUM_CONFIRMATION_DEPTH',
    defaultDepth: 12,
    blockTime: 12,
    family: 'evm',
  },
  {
    chainId: '84532',
    chainName: 'base-sepolia',
    envKey: 'BASE_RPC_URL',
    depthEnvKey: 'BASE_CONFIRMATION_DEPTH',
    defaultDepth: 1,
    blockTime: 2,
    family: 'evm',
  },
  {
    chainId: '421614',
    chainName: 'arbitrum-sepolia',
    envKey: 'ARBITRUM_RPC_URL',
    depthEnvKey: 'ARBITRUM_CONFIRMATION_DEPTH',
    defaultDepth: 1,
    blockTime: 1,
    family: 'evm',
  },
  {
    chainId: '80002',
    chainName: 'polygon-amoy',
    envKey: 'POLYGON_RPC_URL',
    depthEnvKey: 'POLYGON_CONFIRMATION_DEPTH',
    defaultDepth: 64,
    blockTime: 2,
    family: 'evm',
  },
  {
    chainId: 'tron-nile',
    chainName: 'tron-nile',
    envKey: 'TRON_FULL_NODE',
    depthEnvKey: 'TRON_CONFIRMATION_DEPTH',
    defaultDepth: 19,
    blockTime: 3,
    family: 'tron',
  },
  {
    chainId: 'solana-devnet',
    chainName: 'solana-devnet',
    envKey: 'SOLANA_RPC_URL',
    depthEnvKey: 'SOLANA_CONFIRMATION_DEPTH',
    defaultDepth: 1,
    blockTime: 1,
    family: 'solana',
  },
];

type Env = Record<string, string | undefined>;

function readInt(env: Env, key: string, fallback: number, min = 0): number {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < min) {
    throw new ConfigurationError(`${key} must be an integer >= ${min} (got "${raw}")`);
  }
  return parsed;
}

function readString(env: Env, key: string, fallback: string): string {
  const raw = env[key];
  return raw === undefined || raw === '' ? fallback : raw;
}

/**
 * Build the validated worker configuration.
 *
 * @throws ConfigurationError when no chain is configured, or a value is malformed.
 */
export function loadConfig(env: Env = process.env): WorkerConfig {
  const chains: ChainRuntimeConfig[] = [];

  for (const chain of KNOWN_CHAINS) {
    const rpcUrl = env[chain.envKey];
    // A chain with no RPC endpoint is simply not enabled — that is the intended way
    // to run a subset of chains locally, not an error.
    if (!rpcUrl) continue;

    chains.push({
      chainId: chain.chainId,
      chainName: chain.chainName,
      rpcUrl,
      confirmationDepth: readInt(env, chain.depthEnvKey, chain.defaultDepth, 1),
      blockTime: chain.blockTime,
      family: chain.family,
    });
  }

  if (chains.length === 0) {
    const expected = KNOWN_CHAINS.map((c) => c.envKey).join(', ');
    throw new ConfigurationError(
      `No chain RPC endpoints configured. Set at least one of: ${expected}`,
    );
  }

  const nodeEnv = readString(env, 'NODE_ENV', 'development');
  const concurrency = readInt(env, 'WORKER_CONCURRENCY', 4, 1);

  return {
    nodeEnv,
    host: readString(env, 'HOST', '0.0.0.0'),
    port: readInt(env, 'PORT', 3000, 1),
    logLevel: readString(env, 'LOG_LEVEL', 'info'),
    workerId: readString(
      env,
      'WORKER_ID',
      `worker-${process.pid}-${Math.random().toString(36).slice(2, 8)}`,
    ),
    pollIntervalMs: readInt(env, 'WORKER_POLL_INTERVAL_MS', 5000, 100),
    concurrency,
    jobMaxAttempts: readInt(env, 'JOB_MAX_ATTEMPTS', 5, 1),
    jobBackoffBaseMs: readInt(env, 'JOB_BACKOFF_BASE_MS', 1000, 1),
    jobBackoffMaxMs: readInt(env, 'JOB_BACKOFF_MAX_MS', 300000, 1),
    visibilityTimeoutMs: readInt(env, 'JOB_VISIBILITY_TIMEOUT_MS', 120000, 1000),
    watcherRefreshMs: readInt(env, 'WATCHER_REFRESH_MS', 30000, 1000),
    confirmationCheckMs: readInt(env, 'CONFIRMATION_CHECK_MS', 15000, 1000),
    maxWatcherLagBlocks: readInt(env, 'MAX_WATCHER_LAG_BLOCKS', 100, 1),
    chains,
  };
}

/** Chains the worker knows about, exposed for error messages and tests. */
export const knownChainEnvKeys = KNOWN_CHAINS.map((c) => c.envKey);
