/**
 * FlowKey — Worker Process Entry Point
 *
 * This file boots all workers as a SEPARATE PROCESS from the API.
 * Never import this file from the API process.
 *
 * Start workers:
 *   Development:  npx tsx src/workers/index.ts
 *   Production:   node dist/workers/index.js
 *
 * The API process can run without this — jobs queue up in Redis
 * and are processed when the worker comes online.
 *
 * Graceful shutdown: listens for SIGTERM/SIGINT, drains active jobs,
 * then exits cleanly.
 */

import { createEmailWorker } from './email.worker';
import { createSmsWorker } from './sms.worker';
import { createPushWorker } from './push.worker';
import { logger } from '../common/utils/logger';
import { redis } from '../common/utils/redis';
import { initConfig } from '../config';

async function main(): Promise<void> {
  // Initialise config first — workers need SMTP, etc.
  await initConfig();
  logger.info('Worker process starting...');

  // Verify Redis is reachable before starting workers
  // Workers require Redis — fail fast if unavailable
  try {
    await redis.ping();
    logger.info('Worker process: Redis connection verified');
  } catch (err) {
    logger.error('Worker process: Redis unavailable — cannot start workers', {
      error: err instanceof Error ? err.message : String(err),
    });
    process.exit(1);
  }

  // Boot all workers
  const emailWorker = createEmailWorker();
  const smsWorker = createSmsWorker();
  const pushWorker = createPushWorker();

  logger.info('All workers started', {
    workers: ['email-queue', 'sms-queue', 'push-queue'],
  });

  // ---------------------------------------------------------------------------
  // Graceful shutdown
  // ---------------------------------------------------------------------------

  async function shutdown(signal: string): Promise<void> {
    logger.info(`Worker process: received ${signal} — shutting down gracefully`);

    // Close workers — waits for active jobs to finish before stopping
    await Promise.allSettled([emailWorker.close(), smsWorker.close(), pushWorker.close()]);

    // Close Redis connection
    await redis.quit();

    logger.info('Worker process: all workers shut down cleanly');
    process.exit(0);
  }

  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });

  // Catch unhandled promise rejections — log but never crash the worker process
  process.on('unhandledRejection', (reason) => {
    logger.error('Worker process: unhandled rejection', {
      reason: reason instanceof Error ? reason.message : String(reason),
    });
  });
}

main().catch((err) => {
  logger.error('Worker process: fatal startup error', {
    error: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});
