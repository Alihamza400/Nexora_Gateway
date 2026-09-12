/**
 * Worker entrypoint.
 *
 * Runs the background half of the gateway: deposit watching, confirmation tracking
 * and durable job execution. The API gateway serves requests; this process is what
 * makes the intent state machine move.
 *
 * Startup order is deliberate:
 *   1. load and validate config (fail fast, before any connection is opened)
 *   2. compose the graph
 *   3. start
 * A failure anywhere throws and the process exits non-zero, so the orchestrator
 * restarts it rather than leaving a half-initialised worker accepting work.
 */

import { closePool } from '@crypto-gateway/db';
import { loadConfig } from './config.js';
import { ConfigurationError } from './errors.js';
import { compose } from './composition.js';
import { createLogger, type LogLevel } from './logger.js';

const SHUTDOWN_TIMEOUT_MS = 30_000;

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.logLevel as LogLevel, config.nodeEnv !== 'production');

  const runtime = compose(config, logger);

  // Registered before start() so a signal arriving during startup still drains.
  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) {
      logger.warn('shutdown already in progress', { signal });
      return;
    }
    shuttingDown = true;
    logger.info('received shutdown signal', { signal });

    // Hard deadline: a stuck drain must not block the orchestrator's SIGKILL.
    const forceExit = setTimeout(() => {
      logger.error('graceful shutdown timed out; exiting', { timeoutMs: SHUTDOWN_TIMEOUT_MS });
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceExit.unref?.();

    void runtime
      .stop()
      .then(() => closePool())
      .then(() => {
        clearTimeout(forceExit);
        logger.info('shutdown complete');
        process.exit(0);
      })
      .catch((error: unknown) => {
        clearTimeout(forceExit);
        logger.error('shutdown failed', {
          error: error instanceof Error ? error.message : String(error),
        });
        process.exit(1);
      });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('unhandledRejection', (reason: unknown) => {
    // An unhandled rejection means a code path has no owner. Log it loudly with the
    // service still running rather than exiting: losing the deposit watcher would be
    // worse than a noisy log, and the readiness probe will surface the degradation.
    logger.error('unhandled promise rejection', {
      error: reason instanceof Error ? `${reason.name}: ${reason.message}` : String(reason),
    });
  });

  process.on('uncaughtException', (error: Error) => {
    // An uncaught exception leaves unknown state; this one must terminate.
    logger.error('uncaught exception; terminating', { error: `${error.name}: ${error.message}` });
    shutdown('uncaughtException');
  });

  await runtime.start();
}

main().catch((error: unknown) => {
  // Config errors are operator errors and deserve a clear, non-stack message.
  if (error instanceof ConfigurationError) {
    console.error(`worker configuration error: ${error.message}`);
  } else {
    console.error('worker failed to start:', error);
  }
  process.exit(1);
});
