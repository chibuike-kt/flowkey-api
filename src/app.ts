import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import { config } from './config';
import { errorHandler } from './common/middleware/errorHandler';
import { metricsMiddleware } from './common/middleware/metrics';
import { registry } from './common/metrics/index';
import { prisma } from './common/utils/prisma';
import { redis } from './common/utils/redis';
import { notFoundHandler } from './common/middleware/notFound';

// Phase 5 — Auth & Settings routers (active)
import { authRouter } from './features/auth/auth.router';
import { settingsRouter } from './features/settings/settings.router';

// Future phase routers — uncommented as each phase completes
import { kycRouter } from './features/kyc/kyc.router';
import { walletRouter } from './features/wallet/wallet.router';
import { transfersRouter } from './features/transfers/transfers.router';
import { qrRouter } from './features/qr/qr.router';
import { depositsRouter } from './features/deposits/deposits.router';
import { testDepositRouter } from './features/deposits/test-deposit.router'; // ⚠️ REMOVE FOR PRODUCTION
import { cardsRouter } from './features/cards/cards.router';
import { beneficiariesRouter } from './features/beneficiaries/beneficiaries.router';
import { webhooksRouter } from './features/webhooks/webhooks.router';
// import { transferRouter } from './features/transfers/transfers.router';
// import { withdrawalRouter } from './features/withdrawals/withdrawals.router';
// import { billRouter } from './features/bills/bills.router';
// import { qrRouter } from './features/qr/qr.router';
// import { botRouter } from './features/bot/bot.router';
// import { notificationRouter } from './features/notifications/notifications.router';
// import { receiptRouter } from './features/receipts/receipts.router';
// import { disputeRouter } from './features/disputes/disputes.router';
// import { adminRouter } from './features/admin/admin.router';
// import { webhookRouter } from './features/webhooks/webhooks.router';

export function createApp(): express.Application {
  const app = express();
  const cfg = config();

  // -------------------------------------------------------------------------
  // Prometheus metrics — must be first to capture all requests
  // -------------------------------------------------------------------------
  app.use(metricsMiddleware);

  // -------------------------------------------------------------------------
  // Security headers — Helmet configured for API (not browser HTML)
  // CSP is intentionally omitted — client is React Native, not a browser
  // -------------------------------------------------------------------------
  app.use(
    helmet({
      contentSecurityPolicy: false, // not applicable to a JSON API
      crossOriginEmbedderPolicy: false,
      crossOriginOpenerPolicy: false,
      crossOriginResourcePolicy: false,
    }),
  );

  // Remove X-Powered-By (helmet does this by default, but explicit is better)
  app.disable('x-powered-by');

  // -------------------------------------------------------------------------
  // CORS — whitelist only
  // Mobile app doesn't send an Origin header in most cases, but the admin
  // web tool will. Configure the whitelist when the admin tool origin is known.
  // -------------------------------------------------------------------------
  app.use(
    cors({
      origin: cfg.isProduction
        ? (process.env['ALLOWED_ORIGINS'] ?? '').split(',').filter(Boolean)
        : true, // allow all in dev
      methods: ['GET', 'POST', 'PATCH', 'DELETE'],
      allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
      credentials: false, // no cookies — Bearer token auth only
    }),
  );

  // -------------------------------------------------------------------------
  // Body parsing — JSON only. No form submissions, no multipart.
  // -------------------------------------------------------------------------
  app.use(express.json({ limit: '1mb' }));

  // -------------------------------------------------------------------------
  // HTTP request logging — Morgan
  // In production: combined format → CloudWatch
  // In development: dev format → terminal
  // -------------------------------------------------------------------------
  if (!cfg.isTest) {
    app.use(morgan(cfg.isProduction ? 'combined' : 'dev'));
  }

  // -------------------------------------------------------------------------
  // Health check — unauthenticated, no rate limit, used by load balancer
  // -------------------------------------------------------------------------
  app.get('/health', async (_req, res) => {
    const start = Date.now();

    // Ping DB and Redis in parallel — 2s timeout each
    const [dbOk, redisOk] = await Promise.all([
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      (prisma as any).$queryRaw`SELECT 1`.then(() => true).catch(() => false) as Promise<boolean>,
      redis
        .ping()
        .then((r) => r === 'PONG')
        .catch(() => false),
    ]);

    const healthy = dbOk && redisOk;
    const status = healthy ? 'ok' : 'degraded';

    res.status(healthy ? 200 : 503).json({
      status,
      service: 'flowkey-api',
      version: process.env['npm_package_version'] ?? 'unknown',
      timestamp: new Date().toISOString(),
      latency_ms: Date.now() - start,
      checks: {
        database: dbOk ? 'ok' : 'error',
        redis: redisOk ? 'ok' : 'error',
      },
    });
  });

  // -------------------------------------------------------------------------
  // Prometheus metrics scrape endpoint
  // In production: restrict access to your monitoring network / VPC
  // -------------------------------------------------------------------------
  app.get('/metrics', async (_req, res) => {
    try {
      res.set('Content-Type', registry.contentType);
      res.end(await registry.metrics());
    } catch (err) {
      res.status(500).end(err instanceof Error ? err.message : 'metrics error');
    }
  });

  // -------------------------------------------------------------------------
  // API routes — versioned at /api/v1
  // -------------------------------------------------------------------------
  const apiPrefix = `/api/${cfg.apiVersion}`;

  // Phase 5 — Active routes
  app.use(`${apiPrefix}/auth`, authRouter);
  app.use(`${apiPrefix}/settings`, settingsRouter);
  app.use(`${apiPrefix}/kyc`, kycRouter);
  app.use(`${apiPrefix}/wallet`, walletRouter);
  app.use(`${apiPrefix}/transfers`, transfersRouter);
  app.use(`${apiPrefix}/qr`, qrRouter);
  app.use(`${apiPrefix}/deposits`, depositsRouter);
  // ⚠️ REMOVE FOR PRODUCTION — test funding endpoint
  if (process.env['NODE_ENV'] !== 'production') {
    app.use(`${apiPrefix}/test/deposit`, testDepositRouter);
  }
  app.use(`${apiPrefix}/cards`, cardsRouter);
  app.use(`${apiPrefix}/beneficiaries`, beneficiariesRouter);

  // Webhooks — separate prefix, raw body parsing
  app.use('/webhooks/v1', webhooksRouter);

  // Remaining routers mounted as each phase completes:
  //   app.use(`${apiPrefix}/withdrawals`, withdrawalsRouter);
  //   etc.

  // -------------------------------------------------------------------------
  // Webhook routes — separate router, HMAC middleware applied at router level
  // Webhooks are on /webhooks/v1, NOT under /api/v1
  // -------------------------------------------------------------------------
  // app.use('/webhooks/v1', webhookRouter);

  // -------------------------------------------------------------------------
  // 404 handler — must come AFTER all valid routes
  // -------------------------------------------------------------------------
  app.use(notFoundHandler);

  // -------------------------------------------------------------------------
  // Global error handler — must be LAST, after all routes and 404
  // -------------------------------------------------------------------------
  app.use(errorHandler);

  return app;
}
