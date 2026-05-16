import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from 'prom-client';

// ---------------------------------------------------------------------------
// Registry — single instance, shared across the app
// ---------------------------------------------------------------------------

export const registry = new Registry();

registry.setDefaultLabels({ app: 'flowkey-api' });

// Collect Node.js default metrics (event loop lag, heap, GC, etc.)
collectDefaultMetrics({ register: registry });

// ---------------------------------------------------------------------------
// HTTP metrics
// ---------------------------------------------------------------------------

export const httpRequestsTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
  registers: [registry],
});

export const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.01, 0.025, 0.05, 0.1, 0.2, 0.5, 1, 2, 5],
  registers: [registry],
});

export const httpRequestsInFlight = new Gauge({
  name: 'http_requests_in_flight',
  help: 'Number of HTTP requests currently being processed',
  labelNames: ['method', 'route'],
  registers: [registry],
});

// ---------------------------------------------------------------------------
// BullMQ queue metrics
// ---------------------------------------------------------------------------

export const bullmqQueueDepth = new Gauge({
  name: 'bullmq_queue_depth',
  help: 'Number of waiting + delayed jobs in a BullMQ queue',
  labelNames: ['queue_name'],
  registers: [registry],
});

export const bullmqJobsCompleted = new Counter({
  name: 'bullmq_jobs_completed_total',
  help: 'Total number of completed BullMQ jobs',
  labelNames: ['queue_name'],
  registers: [registry],
});

export const bullmqJobsFailed = new Counter({
  name: 'bullmq_jobs_failed_total',
  help: 'Total number of failed BullMQ jobs',
  labelNames: ['queue_name'],
  registers: [registry],
});

// ---------------------------------------------------------------------------
// Business metrics
// ---------------------------------------------------------------------------

export const walletCreditsTotal = new Counter({
  name: 'wallet_credits_total',
  help: 'Total number of wallet credit operations',
  labelNames: ['channel'], // virtual_account | card | test
  registers: [registry],
});

export const transfersTotal = new Counter({
  name: 'transfers_total',
  help: 'Total number of transfer operations',
  labelNames: ['type', 'status'], // type: internal|bank, status: completed|failed|pending
  registers: [registry],
});

export const authEventsTotal = new Counter({
  name: 'auth_events_total',
  help: 'Total number of authentication events',
  labelNames: ['event'],
  // events: registration_initiated | registration_completed | login_success |
  //         login_failed | otp_verified | otp_failed | session_revoked |
  //         passcode_locked | unlock_success | unlock_failed
  registers: [registry],
});

export const kycAttemptsTotal = new Counter({
  name: 'kyc_attempts_total',
  help: 'Total number of KYC upgrade attempts',
  labelNames: ['tier_target', 'status'], // status: passed | failed | error
  registers: [registry],
});

export const activeSessions = new Gauge({
  name: 'active_sessions',
  help: 'Estimated number of active user sessions (non-revoked, non-expired)',
  registers: [registry],
});
