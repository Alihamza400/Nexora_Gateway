/**
 * Worker health, readiness and metrics endpoint.
 *
 * Kept dependency-free: the exposition format for gauges is trivial, and the
 * alternative is a new runtime dependency in the process that holds the signing
 * path. Metrics are emitted in Prometheus text format so the existing scrape
 * configuration works unchanged.
 *
 * Readiness answers a question that matters operationally: *is this worker keeping
 * up?* A process that is running but has lost its chain subscriptions and is
 * accumulating dead letters is not ready, and should be taken out of rotation.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http';
import { healthCheck } from '@crypto-gateway/db';
import type { JobQueue } from './job-queue.js';
import type { DepositWatcher } from './deposit-watcher.js';
import type { ConfirmationTracker } from './confirmation-tracker.js';
import type { Logger } from './logger.js';

export interface HealthServerDeps {
  logger: Logger;
  queue: JobQueue;
  watcher: DepositWatcher;
  tracker: ConfirmationTracker;
  /** Injected so tests can force a specific database state. */
  checkDatabase?: () => Promise<boolean>;
}

export interface HealthServer {
  listen(port: number, host: string): Promise<void>;
  close(): Promise<void>;
  readonly port: number;
}

export function createHealthServer(deps: HealthServerDeps): HealthServer {
  const checkDatabase = deps.checkDatabase ?? healthCheck;
  let server: Server | null = null;
  let actualPort = 0;

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = req.url ?? '/';

    if (url === '/health') {
      respond(res, 200, {
        status: 'ok',
        service: 'crypto-gateway-worker',
        version: '0.1.0',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    if (url === '/health/ready') {
      const database = await checkDatabase().catch(() => false);
      const watcher = deps.watcher.getStats();
      const tracker = deps.tracker.getStats();

      // The watcher must actually be watching something. A worker with zero
      // subscriptions is either misconfigured or has lost its chain connections.
      const watching = watcher.chains > 0;
      const ready = database && watching;

      respond(res, ready ? 200 : 503, {
        status: ready ? 'ready' : 'not_ready',
        database: database ? 'connected' : 'disconnected',
        chainsWatched: watcher.chains,
        addressesWatched: watcher.watchedAddresses,
        depositsReceived: watcher.received,
        depositsUnattributed: watcher.unattributed,
        lastDepositAt: watcher.lastEventAt,
        confirmationSweeps: tracker.sweeps,
        lastSweepAt: tracker.lastSweepAt,
      });
      return;
    }

    if (url === '/metrics') {
      const [queueStats] = await Promise.all([deps.queue.stats().catch(() => null)]);
      const watcher = deps.watcher.getStats();
      const tracker = deps.tracker.getStats();

      const lines: string[] = [
        '# HELP cgw_worker_queue_depth Jobs waiting to run.',
        '# TYPE cgw_worker_queue_depth gauge',
        `cgw_worker_queue_depth{state="pending"} ${queueStats?.pending ?? 0}`,
        `cgw_worker_queue_depth{state="running"} ${queueStats?.running ?? 0}`,
        '# HELP cgw_worker_jobs_dead_lettered Jobs that exhausted their attempts and need a human.',
        '# TYPE cgw_worker_jobs_dead_lettered gauge',
        `cgw_worker_jobs_dead_lettered ${queueStats?.deadLettered ?? 0}`,
        '# HELP cgw_worker_jobs_succeeded_total Jobs completed successfully.',
        '# TYPE cgw_worker_jobs_succeeded_total counter',
        `cgw_worker_jobs_succeeded_total ${queueStats?.succeeded ?? 0}`,
        '# HELP cgw_worker_watched_addresses Deposit addresses currently subscribed.',
        '# TYPE cgw_worker_watched_addresses gauge',
        `cgw_worker_watched_addresses ${watcher.watchedAddresses}`,
        '# HELP cgw_worker_chains_watched Chains with an active subscription.',
        '# TYPE cgw_worker_chains_watched gauge',
        `cgw_worker_chains_watched ${watcher.chains}`,
        '# HELP cgw_worker_deposits_received Deposits observed from the chain.',
        '# TYPE cgw_worker_deposits_received counter',
        `cgw_worker_deposits_received ${watcher.received}`,
        '# HELP cgw_worker_deposits_unattributed Deposits that matched no intent.',
        '# TYPE cgw_worker_deposits_unattributed counter',
        `cgw_worker_deposits_unattributed ${watcher.unattributed}`,
        '# HELP cgw_worker_confirmations_recorded Deposits that reached confirmation depth.',
        '# TYPE cgw_worker_confirmations_recorded counter',
        `cgw_worker_confirmations_recorded ${tracker.confirmed}`,
        '# HELP cgw_worker_up 1 when the worker process is running.',
        '# TYPE cgw_worker_up gauge',
        'cgw_worker_up 1',
      ];

      respondRaw(res, 200, 'text/plain; version=0.0.4; charset=utf-8', `${lines.join('\n')}\n`);
      return;
    }

    respond(res, 404, { error: 'not_found' });
  };

  return {
    get port() {
      return actualPort;
    },
    async listen(port: number, host: string): Promise<void> {
      server = createServer((req, res) => {
        void handle(req, res).catch((error: unknown) => {
          deps.logger.error('health server request failed', {
            error: error instanceof Error ? error.message : String(error),
          });
          if (!res.headersSent) respond(res, 500, { error: 'internal_error' });
        });
      });

      await new Promise<void>((resolve, reject) => {
        server?.once('error', reject);
        server?.listen(port, host, () => {
          const address = server?.address();
          actualPort = typeof address === 'object' && address ? address.port : port;
          resolve();
        });
      });
    },
    async close(): Promise<void> {
      if (!server) return;
      await new Promise<void>((resolve) => server?.close(() => resolve()));
      server = null;
    },
  };
}

function respond(res: ServerResponse, status: number, body: Record<string, unknown>): void {
  respondRaw(res, status, 'application/json; charset=utf-8', JSON.stringify(body));
}

function respondRaw(res: ServerResponse, status: number, contentType: string, body: string): void {
  res.writeHead(status, { 'content-type': contentType, 'cache-control': 'no-store' });
  res.end(body);
}
