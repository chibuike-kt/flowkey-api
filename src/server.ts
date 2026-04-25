/**
 * FlowKey — Server Entry Point
 *
 * Boot sequence:
 *   1. Load dotenv (development/test only — production resolves from AWS)
 *   2. Initialise config (resolves AWS Secrets Manager in production)
 *   3. Validate database connectivity
 *   4. Validate Redis connectivity
 *   5. Create Express app
 *   6. Start HTTP server
 *
 * Anything that fails in steps 1–5 is a hard startup failure.
 * The process exits with code 1 and logs the reason.
 */

// Load environment variables FIRST — before any other imports that might
// access process.env. dotenv.config() is a no-op if NODE_ENV=production
// (AWS Secrets Manager handles secrets in production).
import * as dotenv from 'dotenv';
if (process.env['NODE_ENV'] !== 'production') {
  dotenv.config();
}

import { initConfig, config } from './config';
import { createApp } from './app';
import { logger } from './common/utils/logger';
import { prisma } from './common/utils/prisma';
import { redis } from './common/utils/redis';

async function boot(): Promise<void> {
  // Step 1: Initialise config (resolves secrets from AWS in production)
  await initConfig();
  const cfg = config();

  logger.info('FlowKey API starting', {
    nodeEnv: cfg.nodeEnv,
    port: cfg.port,
    apiVersion: cfg.apiVersion,
  });

  // Step 2: Validate database connectivity
  try {
    await prisma.$queryRaw`SELECT 1`;
    logger.info('Database connection: OK');
  } catch (err) {
    logger.error('Database connection failed — aborting startup', {
      error: err instanceof Error ? err.message : String(err),
    });
    process.exit(1);
  }

  // Step 3: Validate Redis connectivity
  try {
    const pong = await redis.ping();
    if (pong !== 'PONG') throw new Error('Unexpected PING response');
    logger.info('Redis connection: OK');
  } catch (err) {
    logger.error('Redis connection failed — aborting startup', {
      error: err instanceof Error ? err.message : String(err),
    });
    process.exit(1);
  }

  // Step 4: Create Express app
  const app = createApp();

  // Step 5: Start HTTP server
  const server = app.listen(cfg.port, () => {
    logger.info(`FlowKey API listening on port ${cfg.port}`);
  });

  // -------------------------------------------------------------------------
  // Graceful shutdown
  // -------------------------------------------------------------------------
  const shutdown = async (signal: string): Promise<void> => {
    logger.warn(`Received ${signal} — starting graceful shutdown`);

    server.close(async () => {
      logger.info('HTTP server closed');

      try {
        await prisma.$disconnect();
        logger.info('Database disconnected');
      } catch (err) {
        logger.error('Error disconnecting database', {
          error: err instanceof Error ? err.message : String(err),
        });
      }

      try {
        await redis.quit();
        logger.info('Redis disconnected');
      } catch (err) {
        logger.error('Error disconnecting Redis', {
          error: err instanceof Error ? err.message : String(err),
        });
      }

      logger.info('Graceful shutdown complete');
      process.exit(0);
    });

    // Force-kill after 15 seconds if graceful shutdown hangs
    setTimeout(() => {
      logger.error('Graceful shutdown timed out — force exiting');
      process.exit(1);
    }, 15000);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  // Catch unhandled rejections — log and exit
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection — exiting', {
      reason: reason instanceof Error ? reason.message : String(reason),
    });
    process.exit(1);
  });

  // Catch uncaught exceptions — log and exit
  process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception — exiting', { error: err.message });
    process.exit(1);
  });
}

boot().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
