/**
 * FlowKey — Express Application Factory
 *
 * This module creates and configures the Express app.
 * It does NOT call server.listen — that lives in server.ts.
 * This separation allows integration tests to import the app
 * without starting the HTTP server.
 */

import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import { config } from './config';
import { errorHandler } from './common/middleware/errorHandler';
import { notFoundHandler } from './common/middleware/notFound';
import swaggerUi from 'swagger-ui-express';
import { swaggerSpec } from './docs/swagger';

// Phase 5 — Auth & Settings routers (active)
import { authRouter } from './features/auth/auth.router';
import { settingsRouter } from './features/settings/settings.router';

// Future phase routers — uncommented as each phase completes
// import { kycRouter } from './features/kyc/kyc.router';
// import { walletRouter } from './features/wallet/wallet.router';
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
  // Security headers
  // -------------------------------------------------------------------------
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
      crossOriginOpenerPolicy: false,
      crossOriginResourcePolicy: false,
    }),
  );

  app.disable('x-powered-by');

  // -------------------------------------------------------------------------
  // CORS
  // -------------------------------------------------------------------------
  app.use(
    cors({
      origin: cfg.isProduction
        ? (process.env['ALLOWED_ORIGINS'] ?? '').split(',').filter(Boolean)
        : true,
      methods: ['GET', 'POST', 'PATCH', 'DELETE'],
      allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
      credentials: false,
    }),
  );

  // -------------------------------------------------------------------------
  // Body parsing
  // -------------------------------------------------------------------------
  app.use(express.json({ limit: '1mb' }));

  // -------------------------------------------------------------------------
  // Logging
  // -------------------------------------------------------------------------
  if (!cfg.isTest) {
    app.use(morgan(cfg.isProduction ? 'combined' : 'dev'));
  }

  // -------------------------------------------------------------------------
  // Swagger / OpenAPI
  // -------------------------------------------------------------------------
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));


  // -------------------------------------------------------------------------
  // Health check
  // -------------------------------------------------------------------------
  app.get('/health', (_req, res) => {
    res.status(200).json({
      status: 'ok',
      service: 'flowkey-api',
      version: process.env['npm_package_version'] ?? 'unknown',
      timestamp: new Date().toISOString(),
    });
  });

  // -------------------------------------------------------------------------
  // API routes
  // -------------------------------------------------------------------------
  const apiPrefix = `/api/${cfg.apiVersion}`;

  app.use(`${apiPrefix}/auth`, authRouter);
  app.use(`${apiPrefix}/settings`, settingsRouter);

  // Future modules
  // app.use(`${apiPrefix}/kyc`, kycRouter);
  // app.use(`${apiPrefix}/wallet`, walletRouter);
  // app.use(`${apiPrefix}/transfers`, transferRouter);
  // app.use(`${apiPrefix}/withdrawals`, withdrawalRouter);
  // app.use(`${apiPrefix}/bills`, billRouter);
  // app.use(`${apiPrefix}/qr`, qrRouter);
  // app.use(`${apiPrefix}/bot`, botRouter);
  // app.use(`${apiPrefix}/notifications`, notificationRouter);
  // app.use(`${apiPrefix}/receipts`, receiptRouter);
  // app.use(`${apiPrefix}/disputes`, disputeRouter);
  // app.use(`${apiPrefix}/admin`, adminRouter);

  // -------------------------------------------------------------------------
  // Webhooks (separate from API)
  // -------------------------------------------------------------------------
  // app.use('/webhooks/v1', webhookRouter);

  // -------------------------------------------------------------------------
  // 404 handler
  // -------------------------------------------------------------------------
  app.use(notFoundHandler);

  // -------------------------------------------------------------------------
  // Global error handler
  // -------------------------------------------------------------------------
  app.use(errorHandler);

  return app;
}
