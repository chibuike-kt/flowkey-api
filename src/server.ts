/**
 * FlowKey — Server Entry Point
 *
 * Boot sequence:
 *  1. Load environment (dev/test only)
 *  2. Initialise config (AWS secrets in prod)
 *  3. Validate DB
 *  4. Validate Redis
 *  5. Create Express app
 *  6. Start server
 */

import * as dotenv from 'dotenv';

// -----------------------------------------------------------------------------
// 1. ENV LOADING (safe + explicit)
// -----------------------------------------------------------------------------
const isProd = process.env.NODE_ENV === 'production';

if (!isProd) {
  dotenv.config();
}

// -----------------------------------------------------------------------------
// 2. CORE IMPORTS
// -----------------------------------------------------------------------------
import { initConfig, config } from './config';
import { createApp } from './app';
import { logger } from './common/utils/logger';
import { prisma } from './common/utils/prisma';
import { redis } from './common/utils/redis';
import * as net from 'net';

// -----------------------------------------------------------------------------
// BOOT FUNCTION
// -----------------------------------------------------------------------------
async function boot(): Promise<void> {
  await initConfig();
  // TEMP SMTP DEBUG TEST
  const socket = net.createConnection(465, 'smtp.gmail.com');

  socket.setTimeout(10000);

  socket.on('connect', () => {
    console.log('SMTP CONNECTED');
    socket.end();
  });

  socket.on('timeout', () => {
    console.error('SMTP TIMEOUT');
    socket.destroy();
  });

  socket.on('error', (err: Error) => {
    console.error('SMTP ERROR:', err.message);
  });

  const cfg = config();

  logger.info('FlowKey API starting', {
    nodeEnv: cfg.nodeEnv,
    port: cfg.port,
    apiVersion: cfg.apiVersion,
  });

  // ---------------------------------------------------------------------------
  // 1. DATABASE CHECK
  // ---------------------------------------------------------------------------
  try {
    await prisma.$queryRaw`SELECT 1`;
    logger.info('Database connection: OK');
  } catch (err) {
    logger.error('Database connection failed — aborting startup', {
      error: err instanceof Error ? err.message : String(err),
    });
    process.exit(1);
  }

  // ---------------------------------------------------------------------------
  // 2. REDIS CHECK
  // ---------------------------------------------------------------------------
  try {
    const pong = await redis.ping();

    if (pong !== 'PONG') {
      throw new Error(`Unexpected Redis response: ${pong}`);
    }

    logger.info('Redis connection: OK');
  } catch (err) {
    logger.error('Redis connection failed — aborting startup', {
      error: err instanceof Error ? err.message : String(err),
    });
    process.exit(1);
  }

  // ---------------------------------------------------------------------------
  // 3. EXPRESS APP
  // ---------------------------------------------------------------------------
  const app = createApp();

  // ---------------------------------------------------------------------------
  // 4. START SERVER
  // ---------------------------------------------------------------------------
  const server = app.listen(cfg.port, () => {
    logger.info('FlowKey API running', {
      port: cfg.port,
      environment: cfg.nodeEnv,
    });
  });

  // ---------------------------------------------------------------------------
  // GRACEFUL SHUTDOWN
  // ---------------------------------------------------------------------------
  const shutdown = async (signal: string): Promise<void> => {
    logger.warn(`Received ${signal} — shutting down gracefully`);

    server.close(async () => {
      logger.info('HTTP server closed');

      try {
        await prisma.$disconnect();
        logger.info('Database disconnected');
      } catch (err) {
        logger.error('DB disconnect error', {
          error: err instanceof Error ? err.message : String(err),
        });
      }

      try {
        await redis.quit();
        logger.info('Redis disconnected');
      } catch (err) {
        logger.error('Redis disconnect error', {
          error: err instanceof Error ? err.message : String(err),
        });
      }

      logger.info('Shutdown complete');
      process.exit(0);
    });

    // force exit fallback
    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 15000);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  // ---------------------------------------------------------------------------
  // GLOBAL ERROR HANDLERS
  // ---------------------------------------------------------------------------
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection', {
      reason: reason instanceof Error ? reason.message : String(reason),
    });
    process.exit(1);
  });

  process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception', {
      error: err.message,
    });
    process.exit(1);
  });
}

// -----------------------------------------------------------------------------
// BOOT EXECUTION
// -----------------------------------------------------------------------------
boot().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
