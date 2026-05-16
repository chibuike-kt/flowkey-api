# FlowKey API

Production-grade NGN digital wallet backend. Node.js 24 · TypeScript · Express 5 · PostgreSQL 16 (Supabase) · Redis · BullMQ.

---

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [Running the API](#running-the-api)
- [Running Workers](#running-workers)
- [Database](#database)
- [API Reference](#api-reference)
- [Authentication](#authentication)
- [Testing](#testing)
- [Load Testing](#load-testing)
- [Observability](#observability)
- [Feature Flags](#feature-flags)
- [Circuit Breakers](#circuit-breakers)
- [Deployment](#deployment)
- [Phase Status](#phase-status)

---

## Overview

FlowKey is a Nigerian fintech platform that digitises cash-based social payment traditions. The backend handles:

- Wallet funding via virtual bank accounts (Providus NUBAN) and tokenized cards (Paystack)
- Internal transfers between FlowKey wallets and outbound transfers to Nigerian bank accounts
- KYC verification via Prembly (BVN + NIN for Tier 2, address verification for Tier 3)
- QR code generation and scanning for in-person payments
- Double-entry ledger — balances are always computed, never stored as a mutable column

---

## Architecture

```
Client (React Native)
        │
        ▼
Render (Express API — stateless)
        │
        ├── PostgreSQL via Supabase PgBouncer (port 6543)
        ├── Redis (sessions, OTP, feature flags, BullMQ queues)
        ├── BullMQ Workers (email, SMS, push, bank transfer, card deposit)
        └── External providers (Providus, Paystack, Prembly, SMTP)
                    └── Circuit breakers on every provider call
```

**Key architectural decisions:**

- **Stateless API** — no sessions in application memory. All session state in Redis.
- **Double-entry ledger** — `balance = SUM(credits) - SUM(debits)`. No mutable balance column. DB trigger enforces append-only on `ledger_entries`.
- **Async by default** — bank transfers, card deposits, and notifications go through BullMQ. The API never waits for external provider responses.
- **Idempotency everywhere** — every mutating endpoint requires an `Idempotency-Key` header. `creditWallet()` has its own idempotency guard.
- **Pessimistic locking** — `SELECT FOR UPDATE` on all transfer operations to prevent race conditions.
- **Circuit breakers** — opossum wraps every external call. A dead provider returns 503 in milliseconds instead of hanging the request thread.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 24 |
| Language | TypeScript 6 |
| Framework | Express 5 |
| ORM | Prisma 6 |
| Database | PostgreSQL 16 via Supabase |
| Connection pooler | Supabase PgBouncer (port 6543) |
| Cache / sessions | Redis (ioredis) |
| Job queues | BullMQ 5 |
| Auth | RS256 JWT (Bearer tokens) |
| Password hashing | Argon2 |
| Validation | Zod 4 |
| Observability | prom-client (Prometheus) |
| Circuit breakers | opossum |
| Testing | Jest + ts-jest |
| Load testing | k6 |

---

## Project Structure

```
src/
├── app.ts                          # Express app factory
├── server.ts                       # HTTP server entry point, graceful shutdown
├── config/
│   └── index.ts                    # Config loader, PEM key normalisation
├── common/
│   ├── errors/AppError.ts          # Typed error class with HTTP status mapping
│   ├── feature-flags/index.ts      # Redis-backed feature flags with in-memory cache
│   ├── metrics/
│   │   ├── index.ts                # Prometheus registry and metric definitions
│   │   └── queue-collector.ts      # BullMQ queue depth poller
│   ├── middleware/
│   │   ├── errorHandler.ts
│   │   ├── featureFlag.ts          # requireFlag() middleware
│   │   ├── idempotency.ts
│   │   ├── metrics.ts              # HTTP request metrics middleware
│   │   ├── notFound.ts
│   │   ├── rateLimiter.ts
│   │   └── requireAuth.ts
│   ├── resilience/
│   │   └── circuit-breaker.ts      # opossum factory with Prometheus integration
│   └── utils/
│       ├── logger.ts               # Winston logger
│       ├── prisma.ts               # Prisma client with PgBouncer config
│       └── redis.ts                # ioredis singleton
├── features/
│   ├── admin/
│   │   └── flags.router.ts         # Feature flag management API (X-Admin-Key protected)
│   ├── auth/                       # Registration, login, sessions, passcode, PIN, UPP
│   ├── beneficiaries/              # Saved payment targets
│   ├── cards/                      # Paystack-tokenized card management
│   ├── deposits/                   # Virtual account + card deposits + webhooks
│   ├── kyc/                        # KYC tiers 1–3 via Prembly
│   ├── notifications/              # Email + SMS delivery (nodemailer, SMTP)
│   ├── qr/                         # QR code generation and decoding (HMAC-signed)
│   ├── settings/                   # User settings router
│   ├── transfers/                  # Internal + bank transfers, fraud, reversal
│   ├── universal-id/               # 3-word payment identifier
│   ├── wallet/                     # Balance + transaction history
│   └── webhooks/                   # Providus + Paystack inbound webhook processing
├── queues/
│   ├── index.ts                    # Queue definitions (email, SMS, push, bank, card)
│   ├── email.queue.ts              # Queue helpers with dev OTP fallback
│   ├── sms.queue.ts
│   ├── push.queue.ts
│   └── jobs.ts                     # Job type definitions
└── workers/
    ├── index.ts                    # Worker entry point
    ├── email.worker.ts             # SMTP delivery with retry
    ├── sms.worker.ts
    └── push.worker.ts

prisma/
├── schema.prisma
└── migrations/

tests/
├── unit/                           # 539 unit tests across 14 suites
│   ├── phase3/                     # Schema and migration tests
│   ├── phase5/                     # Auth schema tests
│   ├── phase6/                     # KYC tests
│   ├── phase7/                     # Wallet tests
│   ├── phase8/                     # Transfer tests
│   ├── phase10/                    # QR code tests
│   ├── phase11/                    # Deposit + webhook tests
│   └── phase12/                    # Beneficiary tests
└── load/                           # k6 load test scenarios
    ├── config.js
    ├── smoke.js
    ├── auth.js
    ├── wallet.js
    ├── stress.js
    └── spike.js

docs/
├── openapi.json                    # Complete OpenAPI 3.1 spec (60 operations)
├── auth-api.json
├── deposits-api.json
├── beneficiaries-api.json
├── kyc-api.json
├── qr-api.json
├── transfers-api.json
└── wallet-api.json
```

---

## Getting Started

**Prerequisites:**

- Node.js 22+
- PostgreSQL 16 (or Supabase account)
- Redis 7 (or Upstash account)
- A valid RSA key pair for JWT signing

**Install:**

```bash
git clone https://github.com/chibuike-kt/flowkey-api
cd flowkey-api
npm install
cp .env.example .env
# Fill in .env values
```

**Generate RSA keys:**

```bash
openssl genrsa -out private.pem 2048
openssl rsa -in private.pem -pubout -out public.pem
```

Paste the full content of each file into `JWT_PRIVATE_KEY` and `JWT_PUBLIC_KEY` in `.env`.

**Run migrations:**

```bash
npx prisma migrate deploy
npx prisma generate
```

---

## Environment Variables

See [`.env.example`](.env.example) for the full list with documentation.

Key variables:

| Variable | Description |
|---|---|
| `DATABASE_URL` | Supabase pooled URL — **port 6543** (PgBouncer) |
| `DIRECT_URL` | Supabase direct URL — **port 5432** (used only by `prisma migrate`) |
| `REDIS_URL` | Redis connection string |
| `JWT_PRIVATE_KEY` | RSA private key PEM (full content including headers) |
| `JWT_PUBLIC_KEY` | RSA public key PEM |
| `SMTP_HOST` | SMTP server host |
| `ADMIN_API_KEY` | Secret key for admin endpoints (feature flags) |
| `PAYSTACK_SECRET_KEY` | Paystack secret key (webhook verification + card charges) |
| `PROVIDUS_WEBHOOK_SECRET` | HMAC secret for Providus webhook verification |

> **Database URLs:** `DATABASE_URL` must be the PgBouncer pooled URL (port 6543). `DIRECT_URL` must be the direct connection (port 5432). Using the wrong URL for either will cause silent failures or migration errors.

---

## Running the API

```bash
# Development (hot reload)
npm run dev

# Production build + start
npm run build
npm start
```

The API starts on port 3000 by default. On startup you should see:

```
{"message":"Queue depth collector started","queues":[...],"interval_ms":15000}
{"message":"FlowKey API started","port":3000,"env":"development","metrics":"http://localhost:3000/metrics","health":"http://localhost:3000/health"}
```

---

## Running Workers

Workers process BullMQ jobs: email delivery, SMS, push notifications, bank transfers, card deposit charges.

**The API and workers are separate processes.** Both must be running for full functionality.

```bash
# Development (hot reload)
npm run worker:dev

# Production
npm run worker:start
```

On Render, set up a second service pointing to the same repo with start command:

```
node dist/workers/index.js
```

> If workers are not running, OTPs queue up in Redis and are never delivered. The dev fallback logs OTPs to the console when the queue is unavailable (Redis down).

---

## Database

**Schema highlights:**

- `users` — account status, KYC tier (1–3, default 1), Universal ID
- `user_auth` — argon2 hashes, lockout state for passcode + PIN + UPP
- `wallets` — no balance column (computed from ledger)
- `ledger_entries` — append-only credits and debits (DB trigger enforced)
- `transactions` — transfer records with full lifecycle
- `device_sessions` — refresh token hashes, device fingerprints
- `kyc_attempts` — audit trail for all KYC submissions
- `beneficiaries` — soft-deleted, never hard-deleted
- `deposits` — virtual account + card deposit records
- `saved_cards` — Paystack auth codes (never raw card numbers)
- `virtual_accounts` — Providus NUBANs
- `qr_codes` — static and dynamic, HMAC-signed payloads
- `webhooks` — all inbound provider webhooks with processing status

**Migrations:**

```bash
# Create a new migration
npm run migrate:dev -- --name your_migration_name

# Deploy migrations (production)
npm run migrate:deploy
```

---

## API Reference

Full OpenAPI 3.1 spec: [`docs/openapi.json`](docs/openapi.json)

**Import into Postman:** Postman → Import → select `docs/openapi.json`

**View in Swagger UI:** Paste contents of `docs/openapi.json` into [editor.swagger.io](https://editor.swagger.io)

### Endpoint summary (60 operations)

| Tag | Endpoints |
|---|---|
| Auth — Registration | POST /auth/initiate, /verify-otp, /resend-otp, GET /check-username, POST /complete |
| Auth — Session | POST /auth/login, /refresh, /unlock, /logout, /logout-all, GET /auth/me |
| Settings — Passcode | POST /settings/passcode/change, /forgot, /reset |
| Settings — Transaction PIN | GET /settings/pin/status, POST /set, /reset/initiate, /reset/confirm, /reset/complete |
| Settings — UPP | GET /settings/upp/status, POST /set, /reset/initiate, /reset/confirm, /reset/complete |
| Settings — Sessions | GET /settings/sessions, DELETE /settings/sessions/:id |
| Settings — Universal ID | POST /settings/universal-id/revoke |
| KYC | GET /kyc/status, /attempts, POST /kyc/upgrade |
| Wallet | GET /wallet/balance, /wallet/transactions |
| Transfers | POST /transfers/resolve-recipient, /internal, /bank, GET /, /:id, POST /:id/retry |
| QR Codes | POST /qr/generate, /decode, GET /, /:id, DELETE /:id |
| Deposits | POST /deposits/virtual-account, GET /virtual-account, POST /deposits/card, GET /deposits |
| Cards | POST /cards, GET /cards, DELETE /cards/:id |
| Beneficiaries | POST /beneficiaries, GET /, /:id, PATCH /:id, DELETE /:id |
| Webhooks | POST /webhooks/v1/providus, /webhooks/v1/paystack |
| System | GET /health, /metrics, POST /test/deposit (dev only) |

---

## Authentication

FlowKey uses **RS256 JWT Bearer tokens**.

**Token lifecycle:**

1. Login or complete registration → receive `access_token` + `refresh_token` + `access_token_expires_at`
2. Use `access_token` in `Authorization: Bearer <token>` header
3. At ~2 minutes before `access_token_expires_at`, call `POST /auth/refresh` to get a new pair — user never sees a logout
4. Refresh token has a 30-day sliding window — resets on every refresh call
5. On app open after idle: call `POST /auth/unlock` with stored `refresh_token` + passcode

**Screen lock flow (client responsibility):**

```
App opens / foreground
  └── idle < 5 min → POST /auth/refresh silently → dashboard
  └── idle > 5 min → show passcode screen → POST /auth/unlock → dashboard
  └── refresh token expired → show login screen → POST /auth/login
```

**Passcode:** 6 digits. Used for login and unlock.

**Transaction PIN:** 4 digits. Required for all transfers and card deposits.

**UPP (Universal Payment PIN):** 6 digits. For high-value payment authorisation.

---

## Testing

```bash
# All unit tests
npm test

# Unit tests only
npm run test:unit

# With coverage
npm run test:coverage
```

**Current status: 539/539 tests passing across 14 suites.**

Tests are pure unit tests — no database or Redis connection required. All Prisma and Redis calls are mocked.

---

## Load Testing

Load tests use [k6](https://k6.io). Install separately:

```bash
# macOS
brew install k6
```

```bash
# Smoke test — verify API is reachable (run first)
BASE_URL=https://your-api.render.com npm run load:smoke

# Auth flow — 20 concurrent users
BASE_URL=https://your-api.render.com \
TEST_BEARER_TOKEN=eyJ... \
npm run load:auth

# Wallet hot paths — 30 concurrent users
BASE_URL=https://your-api.render.com \
TEST_BEARER_TOKEN=eyJ... \
npm run load:wallet

# Stress test — ramp to 100 VUs to find ceiling
BASE_URL=https://your-api.render.com \
TEST_BEARER_TOKEN=eyJ... \
npm run load:stress

# Spike test — sudden burst to 200 VUs
BASE_URL=https://your-api.render.com \
TEST_BEARER_TOKEN=eyJ... \
npm run load:spike
```

**Pass/fail thresholds:** HTTP error rate < 1%, P95 < 500ms, P99 < 1000ms.

---

## Observability

**Metrics endpoint:** `GET /metrics` — Prometheus text format.

**Metrics exposed:**

| Metric | Type | Description |
|---|---|---|
| `http_requests_total` | Counter | Request count by method, route, status |
| `http_request_duration_seconds` | Histogram | Latency with 9 buckets (10ms–5s) |
| `http_requests_in_flight` | Gauge | Active concurrent requests |
| `bullmq_queue_depth` | Gauge | Waiting + delayed jobs per queue |
| `bullmq_jobs_completed_total` | Counter | Completed jobs per queue |
| `bullmq_jobs_failed_total` | Counter | Failed jobs per queue |
| `wallet_credits_total` | Counter | Wallet credits by channel |
| `transfers_total` | Counter | Transfers by type and status |
| `auth_events_total` | Counter | Login, register, OTP events |
| `kyc_attempts_total` | Counter | KYC attempts by tier and result |
| `circuit_breaker_state_*` | Gauge | 0=closed, 1=open, 2=half-open per provider |
| Node.js defaults | Various | Heap, GC, event loop lag |

**Health check:** `GET /health` — pings PostgreSQL and Redis. Returns 503 if either is down.

**Grafana Cloud (free tier):** Connect to `https://your-api.render.com/metrics` as a Prometheus data source. Import dashboard ID **11159** for instant Node.js dashboards.

---

## Feature Flags

Flags are stored in Redis and cached in memory for 5 seconds. The API falls back to code defaults if Redis is unavailable.

**Admin API** (requires `X-Admin-Key` header):

```bash
# List all flags
curl https://your-api.render.com/admin/flags \
  -H "X-Admin-Key: your-admin-key"

# Disable bank transfers (emergency kill switch — no deployment needed)
curl -X PUT https://your-api.render.com/admin/flags/transfers.bank \
  -H "X-Admin-Key: your-admin-key" \
  -H "Content-Type: application/json" \
  -d '{"enabled": false}'

# Re-enable
curl -X PUT https://your-api.render.com/admin/flags/transfers.bank \
  -H "X-Admin-Key: your-admin-key" \
  -H "Content-Type: application/json" \
  -d '{"enabled": true}'

# Reset to default
curl -X DELETE https://your-api.render.com/admin/flags/transfers.bank \
  -H "X-Admin-Key: your-admin-key"
```

**Available flags:**

| Flag | Default | Controls |
|---|---|---|
| `deposits.virtual_account` | true | Virtual account provisioning |
| `deposits.card` | true | Card deposit flow |
| `kyc.tier2` | true | Tier 2 KYC upgrades |
| `kyc.tier3` | true | Tier 3 KYC upgrades |
| `transfers.bank` | true | Outbound bank transfers |
| `transfers.internal` | true | FlowKey-to-FlowKey transfers |
| `transfers.qr` | true | QR code payments |
| `beneficiaries` | true | Beneficiary management |
| `qr_codes` | true | QR code generation |
| `test.deposit` | false | Test deposit endpoint |

Set `ADMIN_API_KEY` in environment. Generate a secure key: `openssl rand -hex 32`.

---

## Circuit Breakers

Every external provider call is wrapped in an opossum circuit breaker. When a provider fails repeatedly, the breaker opens and requests fail in milliseconds with `503 EXTERNAL_SERVICE_ERROR` instead of hanging.

| Breaker | Provider | Timeout | Reset after |
|---|---|---|---|
| `providus` | Virtual account provisioning | 15s | 60s |
| `paystack-verify` | Card auth verification | 10s | 30s |
| `paystack-charge` | Card charge | 15s | 60s |
| `prembly-bvn` | BVN verification | 12s | 60s |
| `prembly-nin` | NIN verification | 12s | 60s |
| `prembly-address` | Address verification | 12s | 60s |
| `smtp` | Email delivery | 15s | 30s |

Breaker state is visible in Prometheus: `circuit_breaker_state_{name}` — 0 = closed (healthy), 1 = open (failing), 2 = half-open (testing recovery).

---

## Deployment

**Render setup:**

1. **API service** — start command: `npm run build && npm start`
2. **Worker service** — same repo, start command: `node dist/workers/index.js`
3. **Build command** (both services): `npm install && npx prisma generate`

**Required environment variables on Render:**

- `DATABASE_URL` — Supabase pooled URL (port 6543)
- `DIRECT_URL` — Supabase direct URL (port 5432)
- `REDIS_URL`
- `JWT_PRIVATE_KEY` / `JWT_PUBLIC_KEY` — full PEM content
- `SMTP_*` — mail credentials
- `ADMIN_API_KEY` — `openssl rand -hex 32`
- `NODE_ENV=production`

**Run the KYC tier migration** on Supabase SQL editor before first deploy if upgrading from a version with tier 0:

```sql
UPDATE "users" SET "kyc_tier" = 1 WHERE "kyc_tier" = 0;
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_kyc_tier_check";
ALTER TABLE "users" ADD CONSTRAINT "users_kyc_tier_check" CHECK ("kyc_tier" >= 1 AND "kyc_tier" <= 3);
ALTER TABLE "users" ALTER COLUMN "kyc_tier" SET DEFAULT 1;
```

---

## Phase Status

| Phase | Feature | Status |
|---|---|---|
| 1–4 | Architecture, schema, initial OpenAPI | ✅ |
| 5 | Auth (registration, login, sessions, passcode, PIN, UPP, Universal ID) | ✅ |
| 6 | KYC (tiers 1–3, Prembly stub) | ✅ |
| 7 | Wallet (balance, transactions) | ✅ |
| 8–9 | Transfers (internal, QR, UID, bank async, fraud, reversal, retry) | ✅ |
| 10 | QR codes (static, dynamic, HMAC-signed) | ✅ |
| 11 | Deposits (virtual account, card tokenization, webhooks) | ✅ |
| 12 | Beneficiaries | ✅ |
| 13 | Payment Requests | 🔲 |
| 14 | Notifications (in-app list, preferences) | 🔲 |
| 15 | Receipts | 🔲 |
| 16 | Admin panel | 🔲 |
| 17 | Disputes | 🔲 |
| 18 | Bot / conversational interface | 🔲 |
| 19 | Security hardening | 🔲 |
| 20 | Worker infrastructure | 🔲 |
| 21 | OpenAPI completion + docs | 🔲 |

---

## Links

- GitHub: [github.com/chibuike-kt/flowkey-api](https://github.com/chibuike-kt/flowkey-api)
- Twitter: [@chibuike_kt](https://twitter.com/chibuike_kt)
