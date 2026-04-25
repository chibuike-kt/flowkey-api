# FlowKey API

Production-grade fintech orchestration backend. Node.js 22 + TypeScript + Express + Prisma + PostgreSQL + Redis + BullMQ.

---

## Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Node.js | 22.x | Use `nvm use` in the repo root |
| npm | 10.x | Comes with Node 22 |
| Docker | Latest stable | For local Postgres + Redis |
| Docker Compose | v2+ | Bundled with Docker Desktop |
| make | Any | Optional but recommended |
| openssl | Any | For generating local JWT keys |

---

## First-time setup

### 1. Clone and install

```bash
git clone git@github.com:YOUR_ORG/flowkey-api.git
cd flowkey-api
nvm use          # switches to Node 22 via .nvmrc
npm install
```

### 2. Start infrastructure services

```bash
make up
# or without make:
docker compose up -d
```

This starts:
- **PostgreSQL 16** on `localhost:5433` (non-default port to avoid conflicts)
- **Redis 7** on `localhost:6380` (non-default port to avoid conflicts)

Both bind to `127.0.0.1` only — not exposed to your network.

### 3. Configure environment

```bash
cp .env.example .env
```

Then open `.env` and fill in the required values. The minimum required for local dev:

**Generate JWT keys:**
```bash
make keys
# or manually:
mkdir -p secrets
openssl genrsa -out secrets/private.pem 4096
openssl rsa -in secrets/private.pem -pubout -out secrets/public.pem
```

Copy the PEM content into `.env` as `JWT_PRIVATE_KEY` and `JWT_PUBLIC_KEY`, replacing newlines with `\n`.

**SMTP (email OTP):** Use [Ethereal](https://ethereal.email) for local dev — create a free test account and paste the credentials into `.env`.

Everything else has working defaults for local development.

### 4. Generate Prisma client

```bash
npm run db:generate
# or:
make generate
```

### 5. Run migrations

```bash
npm run migrate:dev
# or:
make migrate
```

### 6. Start the dev server

```bash
npm run dev
# or:
make dev
```

The server starts on `http://localhost:3000`.

Health check: `GET http://localhost:3000/health`

---

## Environment variables

All variables are documented in `.env.example` with comments explaining each one and where to get the value. Never add undocumented variables.

`.env` is gitignored and must never be committed.

In production, secrets are resolved from AWS Secrets Manager at startup. Non-secret config is passed as environment variables via the deployment platform (ECS task definition). See `src/config/index.ts` for the full resolution logic.

---

## Running tests

### All tests
```bash
npm test
```

### By suite
```bash
npm run test:unit          # unit tests — no database required
npm run test:integration   # integration tests — requires Docker services up
npm run test:concurrency   # concurrency tests — requires Docker services up
npm run test:failure       # failure path tests — requires Docker services up
```

### With coverage
```bash
npm run test:coverage
```

Coverage threshold is 100% for all phase-introduced code paths. The CI pipeline enforces this and will fail if coverage drops.

**Note on Argon2 in tests:** CI and test environments use reduced Argon2 parameters (`ARGON2_MEMORY_COST=256`, `ARGON2_TIME_COST=1`) for speed. These are set in the CI workflow and in your `.env` for test mode. Never use reduced parameters in production.

---

## Database

### Migrations

All schema changes go through Prisma migrations. Never modify the database schema manually.

```bash
# Create a new migration (dev only — generates the migration file)
npm run migrate:dev

# Apply pending migrations (production / CI)
npm run migrate:deploy

# Reset the database (dev only — destructive)
npm run migrate:reset
```

Every migration file must include a rollback strategy in the header comment before it is merged to `develop`. See `prisma/migrations/` for examples.

### Prisma Studio (local DB browser)

```bash
npm run db:studio
```

### Seed data

```bash
npm run db:seed
```

---

## Project structure

```
flowkey-api/
├── src/
│   ├── config/           # Config service — resolves env + AWS Secrets Manager
│   ├── common/
│   │   ├── errors/       # AppError class + ErrorCode enum
│   │   ├── middleware/   # errorHandler, notFound, auth, rate-limit, idempotency
│   │   ├── types/        # Shared TypeScript types (ApiResponse, etc.)
│   │   └── utils/        # logger, prisma singleton, redis singleton
│   ├── features/         # Feature-based modules (one directory per domain)
│   │   ├── auth/         # Registration, login, session, passcode
│   │   ├── kyc/          # Tier system, Prembly integration
│   │   ├── wallet/       # Balance engine, ledger
│   │   ├── transfers/    # FlowKey → FlowKey
│   │   ├── withdrawals/  # FlowKey → Bank (Providus)
│   │   ├── bills/        # Bill payments
│   │   ├── qr/           # QR code generation and scan-to-pay
│   │   ├── bot/          # Conversational transaction bot
│   │   ├── notifications/# Push, email, SMS delivery
│   │   ├── receipts/     # PDF generation, signed URLs
│   │   ├── disputes/     # Dispute lifecycle
│   │   ├── admin/        # Admin API
│   │   └── webhooks/     # Inbound webhook ingestion
│   ├── workers/          # BullMQ worker definitions
│   ├── queues/           # BullMQ queue definitions
│   ├── jobs/             # Scheduled/reconciliation jobs
│   ├── data/             # Static data (Universal ID wordlist)
│   ├── app.ts            # Express app factory
│   └── server.ts         # Entry point — boots config and starts HTTP server
├── prisma/
│   ├── schema.prisma     # Database schema (source of truth)
│   ├── migrations/       # Migration history — never modify manually
│   └── seed.ts           # Seed data for development
├── tests/
│   ├── unit/             # Unit tests — mocked dependencies
│   ├── integration/      # Integration tests — real Postgres + Redis
│   ├── concurrency/      # Concurrency tests — race condition validation
│   └── failure/          # Failure path tests — provider timeouts, DB failures
├── docs/
│   ├── ADL.md            # Architecture Decision Log
│   ├── SECURITY.md       # Security Decisions Log
│   ├── flows/            # Data flow diagrams (one per major flow)
│   └── adr/              # Individual ADR files (if needed)
├── scripts/              # Dev utility scripts
├── .github/workflows/    # CI pipeline (GitHub Actions)
├── docker-compose.yml    # Local dev infrastructure
├── Makefile              # Developer convenience commands
├── .env.example          # Environment variable reference (all keys documented)
├── tsconfig.json         # TypeScript config (strict mode)
├── jest.config.ts        # Jest config
├── .eslintrc.json        # ESLint config
├── .prettierrc           # Prettier config
└── commitlint.config.js  # Commit message validation
```

Each feature module follows this internal structure:
```
features/auth/
├── auth.router.ts        # Express router — routes only, no logic
├── auth.controller.ts    # Request parsing, response formatting
├── auth.service.ts       # Business logic — the only place that owns decisions
├── auth.schema.ts        # Zod validation schemas
└── auth.types.ts         # Feature-specific TypeScript types
```

---

## Git workflow

Branch strategy follows Gitflow. Both `main` and `develop` are protected — no direct push.

```bash
# Start a feature
git checkout develop
git pull
git checkout -b feature/your-feature-name

# Start a security change
git checkout -b security/your-change-description

# Start a fix
git checkout -b fix/your-bug-description
```

### Commit format (enforced by commitlint + husky)

```
type(scope): imperative description
```

Valid types: `feat`, `fix`, `security`, `db`, `test`, `docs`, `refactor`, `chore`

Examples:
```
feat(auth): implement login passcode with argon2id and progressive lockout
security(pin): implement transaction pin hard lockout via redis
db(ledger): enforce append-only constraint on ledger_entries via trigger
test(wallet): add concurrency test for simultaneous debit race condition
fix(webhook): handle out-of-order providus webhook without state corruption
docs(adr): record decision to use bearer tokens over cookies for rn client
```

Commitlint runs automatically via a Git hook on every commit. The CI pipeline also validates commit messages on PRs.

---

## Making a PR

Every PR must include:
- Description of what changed and why
- Test evidence (CI output or coverage report)
- Migration notes if schema changes are involved
- ADL entry if an architectural decision was made

No squash merges. Full commit history is preserved.

---

## Phase tracker

| Phase | Name | Status |
|-------|------|--------|
| 1 | System architecture + threat model | ✅ Complete |
| 2 | Environment + repo setup | ✅ Complete |
| 3 | Database schema + migrations | 🔲 Next |
| 4 | API contracts | 🔲 Pending |
| 5 | Auth & identity | 🔲 Pending |
| 6 | Universal ID | 🔲 Pending |
| 7 | Wallet + ledger | 🔲 Pending |
| 8 | Internal transfers | 🔲 Pending |
| 9 | Bank withdrawals | 🔲 Pending |
| 10 | Bill payments | 🔲 Pending |
| 11 | QR payments | 🔲 Pending |
| 12 | Payment requests + beneficiaries | 🔲 Pending |
| 13 | KYC + tier system | 🔲 Pending |
| 14 | Notifications | 🔲 Pending |
| 15 | Receipt system | 🔲 Pending |
| 16 | Conversational bot | 🔲 Pending |
| 17 | Queue workers + background jobs | 🔲 Pending |
| 18 | Admin API | 🔲 Pending |
| 19 | Dispute & reversal system | 🔲 Pending |
| 20 | Security hardening | 🔲 Pending |
| 21 | End-to-end validation + load testing | 🔲 Pending |
