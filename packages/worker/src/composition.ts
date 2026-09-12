/**
 * Composition root.
 *
 * Every service is constructed in one place with explicit dependencies. No
 * module-level singletons: tests build the same graph with fakes, and there is a
 * single place to look when asking "what is this process actually running?".
 *
 * Scope today is the deposit lifecycle:
 *
 *   chain event → durable job → intent state machine → confirmation
 *
 * Settlement, routing, compliance, recovery and reconciliation are constructed in
 * the next increment (WS1.6 onward). They are deliberately not constructed here
 * yet rather than wired speculatively: a service that is built but never called
 * looks identical to one that works, which is the failure mode this whole plan
 * exists to eliminate.
 */

import {
  ChainRegistry,
  EVMChainClient,
  TronChainClient,
  SolanaChainClient,
} from '@crypto-gateway/chain-abstraction';
import {
  PaymentIntentService,
  PaymentIntentRepository,
  MerchantConfigService,
  WebhookDeliveryService,
} from '@crypto-gateway/payment-intent';
import type { IChainClient } from '@crypto-gateway/shared';
import type { ChainRuntimeConfig, WorkerConfig } from './config.js';
import { DepositWatcher } from './deposit-watcher.js';
import { ConfirmationTracker } from './confirmation-tracker.js';
import { JobQueue, type JobQueueOptions } from './job-queue.js';
import { registerJobHandlers } from './job-handlers.js';
import { createHealthServer, type HealthServer } from './health-server.js';
import type { Logger } from './logger.js';

export interface WorkerRuntime {
  config: WorkerConfig;
  registry: ChainRegistry;
  chainClients: IChainClient[];
  queue: JobQueue;
  watcher: DepositWatcher;
  tracker: ConfirmationTracker;
  health: HealthServer;
  intentService: PaymentIntentService;
  start(): Promise<void>;
  stop(): Promise<void>;
}

/** Build a chain client for the configured family. */
export function createChainClient(chain: ChainRuntimeConfig): IChainClient {
  switch (chain.family) {
    case 'evm':
      return new EVMChainClient(chain.chainId, chain.chainName, chain.rpcUrl, {
        confirmationDepth: chain.confirmationDepth,
        blockTime: chain.blockTime,
      });
    case 'tron':
      return new TronChainClient({
        chainId: chain.chainId,
        chainName: chain.chainName,
        rpcUrl: chain.rpcUrl,
        confirmationDepth: chain.confirmationDepth,
        blockTime: chain.blockTime,
      });
    case 'solana':
      return new SolanaChainClient({
        chainId: chain.chainId,
        chainName: chain.chainName,
        rpcUrl: chain.rpcUrl,
        wsUrl: chain.rpcUrl.replace(/^http/, 'ws'),
        confirmationDepth: chain.confirmationDepth,
      });
  }
}

export function compose(config: WorkerConfig, logger: Logger): WorkerRuntime {
  // ─── Chain layer ───────────────────────────────────────────────────────────
  const registry = new ChainRegistry();
  const chainClients = config.chains.map((chain) => {
    const client = createChainClient(chain);
    registry.register(client);
    return client;
  });

  // ─── Persistence + intent state machine ────────────────────────────────────
  const intentRepository = new PaymentIntentRepository();
  const merchantService = new MerchantConfigService();
  const webhookService = new WebhookDeliveryService(merchantService);
  const intentService = new PaymentIntentService(intentRepository, merchantService, webhookService);

  // ─── Durable job queue ─────────────────────────────────────────────────────
  const queueOptions: JobQueueOptions = {
    workerId: config.workerId,
    pollIntervalMs: config.pollIntervalMs,
    concurrency: config.concurrency,
    defaultMaxAttempts: config.jobMaxAttempts,
    backoffBaseMs: config.jobBackoffBaseMs,
    backoffMaxMs: config.jobBackoffMaxMs,
    visibilityTimeoutMs: config.visibilityTimeoutMs,
  };
  const queue = new JobQueue(queueOptions);
  registerJobHandlers(queue, { intentService, logger });

  // ─── Observers ─────────────────────────────────────────────────────────────
  const watcher = new DepositWatcher({
    chains: chainClients,
    repository: intentRepository,
    queue,
    logger,
    refreshIntervalMs: config.watcherRefreshMs,
  });

  const tracker = new ConfirmationTracker({
    chains: chainClients,
    repository: intentRepository,
    intentService,
    queue,
    logger,
    intervalMs: config.confirmationCheckMs,
  });

  const health = createHealthServer({ logger, queue, watcher, tracker });

  let queueAbort: AbortController | null = null;
  let queueLoop: Promise<void> | null = null;

  return {
    config,
    registry,
    chainClients,
    queue,
    watcher,
    tracker,
    health,
    intentService,

    async start(): Promise<void> {
      await health.listen(config.port, config.host);
      logger.info('worker http endpoint listening', { port: health.port });

      await watcher.start();
      tracker.start();

      queueAbort = new AbortController();
      queueLoop = queue.run(queueAbort.signal).catch((error: unknown) =>
        logger.error('job queue loop terminated unexpectedly', {
          error: error instanceof Error ? error.message : String(error),
        }),
      );

      logger.info('worker started', {
        workerId: config.workerId,
        chains: config.chains.map((c) => c.chainId),
        concurrency: config.concurrency,
        jobTypes: queue.getRegisteredJobTypes(),
      });
    },

    /**
     * Shut down in dependency order: stop observing, then stop accepting work, then
     * close connections. A reversed order would let a job start after the watcher
     * stopped, which is harmless, but letting the pool close before an in-flight job
     * finishes is not.
     */
    async stop(): Promise<void> {
      logger.info('worker draining');

      tracker.stop();
      watcher.stop();

      queueAbort?.abort();
      await queueLoop?.catch(() => undefined);

      await health.close();
      logger.info('worker stopped');
    },
  };
}
