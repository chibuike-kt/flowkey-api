import { createApp } from './app';
import { config, initConfig } from './config';
import { logger } from './common/utils/logger';
import { startQueueCollector, stopQueueCollector } from './common/metrics/queue-collector';

async function main(): Promise<void> {
  // Initialise config (loads .env, AWS Secrets Manager in production)
  initConfig();
  const cfg = config();

  const app = createApp();
  const port = cfg.port;

  // Start background collectors
  startQueueCollector(cfg.redisUrl);

  const server = app.listen(port, () => {
    logger.info(`FlowKey API started`, {
      port,
      env: cfg.nodeEnv,
      version: process.env['npm_package_version'] ?? 'unknown',
      metrics: `http://localhost:${port}/metrics`,
      health: `http://localhost:${port}/health`,
    });
  });

  // ---------------------------------------------------------------------------
  // Graceful shutdown
  // ---------------------------------------------------------------------------

  let shuttingDown = false;

  function shutdown(signal: string): void {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info(`${signal} received — starting graceful shutdown`);

    stopQueueCollector();

    server.close((err) => {
      if (err) {
        logger.error('Error during server close', { error: err.message });
        process.exit(1);
      }
      logger.info('Server closed — exiting cleanly');
      process.exit(0);
    });

    // Force exit after 10 seconds if graceful close stalls
    setTimeout(() => {
      logger.error('Graceful shutdown timed out — forcing exit');
      process.exit(1);
    }, 10_000);
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception', { error: err.message, stack: err.stack });
    shutdown('uncaughtException');
  });

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection', {
      reason: reason instanceof Error ? reason.message : String(reason),
    });
    shutdown('unhandledRejection');
  });
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error('Fatal startup error:', message);
  process.exit(1);
});
