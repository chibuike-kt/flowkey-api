# FlowKey — Architecture Decision Log (ADL)

Every significant architectural decision is recorded here.
Format: date, context, options considered, decision, consequences.

---

## ADL-001 — Bearer Tokens over Cookies for React Native Client

**Date:** Phase 2
**Status:** Decided

**Context:**
FlowKey's client is a React Native mobile application. Authentication tokens must be stored securely on the client and transmitted to the backend on every request.

**Options considered:**

1. httpOnly cookies
2. Bearer tokens in Authorization header, stored in OS secure enclave (Expo SecureStore / RN Keychain)

**Decision:** Bearer tokens in Authorization header.

**Reasoning:**
httpOnly cookies are a browser security primitive. Their purpose is to prevent XSS attacks from stealing tokens out of the DOM. React Native has no DOM and no browser cookie jar. Implementing cookie-based auth in React Native requires a WebView shim — an architectural hack that introduces more complexity than it solves.

Expo SecureStore (iOS Keychain / Android EncryptedSharedPreferences) is hardware-backed on all modern devices. It is the mobile equivalent of httpOnly cookies and is what these OS APIs are specifically designed for.

**Consequences:**
- Client stores access token and refresh token in SecureStore/Keychain only
- No AsyncStorage, no Redux-persisted state, no logging of tokens
- All requests send: `Authorization: Bearer <access_token>`
- Refresh flow uses request body (not cookie)
- Rooted device attacks are the primary residual risk — same risk that httpOnly cookies face on a compromised browser

---

## ADL-002 — TypeORM Rejected in Favour of Prisma

**Date:** Phase 2
**Status:** Decided

**Context:**
ORM selection for a TypeScript fintech backend with strict migration discipline requirements.

**Options considered:**

1. Prisma (schema-first, generated client, built-in migration runner)
2. TypeORM (decorator-based, more flexible raw SQL integration)
3. Knex (query builder, no ORM, full SQL control)
4. Raw SQL via pg driver

**Decision:** Prisma.

**Reasoning:**
Prisma's schema-first approach means the database schema is always derived from `prisma/schema.prisma` — the single source of truth. Migration files are generated automatically and are auditable. This is critical for a system that will be handed to a larger team at Series A.

TypeORM's decorator-based model can produce non-deterministic migration output and has historically had issues with complex migration scenarios. The raw SQL escape hatch in Prisma (`$queryRaw`, `$executeRaw`) covers any case where the ORM layer is insufficient.

Knex and raw SQL were rejected because the loss of type safety at the query layer introduces too much risk in a financial system.

**Consequences:**
- All schema changes go through `prisma migrate dev` — no manual SQL in any environment
- Every migration must have a documented rollback strategy in the migration file header
- Prisma client is generated at build time — `prisma generate` is part of CI
- Complex ledger queries (derived balance, SELECT FOR UPDATE) use `$queryRaw` with full type annotations

---

## ADL-003 — No Terminal Mode in v1

**Date:** Phase 2 (confirmed during Phase 1 review)
**Status:** Decided

**Context:**
The original system prompt described a "Terminal Mode" where payments could be initiated from pre-registered physical terminal devices without the payer's personal phone. This involved terminal JWT tokens, Universal Payment PINs, and terminal-specific session management.

**Decision:** Terminal Mode is removed from scope entirely.

**Reasoning:**
Confirmed by the product owner: FlowKey is an app-based product. There are no physical terminals. The payer is always the FlowKey app user on their own device. The Universal Payment PIN, terminal device registration, terminal JWT tokens, and terminal session management are all removed.

**Consequences:**
- `terminal_devices` table is not built
- Universal Payment PIN (UPP) as a third auth factor is removed
- The `device_sessions` table is retained for regular user app sessions
- `transactions.initiator_type` enum retains `terminal` for future extensibility but it is not used in v1

---

## ADL-004 — AWS Secrets Manager for Production Secrets

**Date:** Phase 2
**Status:** Decided

**Context:**
Production secrets (JWT private key, Prembly API key, database credentials, webhook secrets) must never live in source code, environment files, or deployment artifacts.

**Options considered:**

1. AWS Secrets Manager
2. Doppler
3. HashiCorp Vault
4. Encrypted environment variables in deployment platform

**Decision:** AWS Secrets Manager.

**Reasoning:**
Confirmed by the product owner. AWS Secrets Manager integrates natively with ECS/EC2 via IAM roles — no access keys required in the compute environment. Secret rotation is built-in. Audit trail via CloudTrail.

**Consequences:**
- `src/config/index.ts` resolves secrets from AWS Secrets Manager at startup in production
- Development and test environments use dotenv (`.env` file, gitignored)
- No AWS credentials are stored in the application — IAM roles on the compute unit provide access
- AWS region defaults to `af-south-1` (Cape Town) — update to actual deployment region before production

---

## ADL-005 — Argon2id for All PIN and Passcode Hashing

**Date:** Phase 2
**Status:** Decided

**Context:**
Three authentication factors must be stored as hashes: login passcode (6-digit), transaction PIN (4-digit), and any future factors. Low-entropy inputs (short numeric PINs) require a memory-hard KDF to resist GPU-accelerated brute force.

**Decision:** Argon2id with parameters: memory=64MB, iterations=3, parallelism=4, output=32B, salt=16B (random per hash).

**Reasoning:**
Argon2id is the winner of the Password Hashing Competition (2015) and the current OWASP recommendation for low-entropy credentials. The `id` variant combines Argon2i's side-channel resistance with Argon2d's GPU resistance — appropriate for server-side hashing where both threats exist.

Parameters are stored alongside each hash to enable future migration without invalidating existing hashes.

**Consequences:**
- Parameters are documented in `.env.example` and `docs/SECURITY.md`
- CI uses reduced parameters (memory=256KB, iterations=1) for test speed — clearly documented, never used in production
- Each factor has its own hash and its own salt — three hashes per user in `user_auth`
- Compromise of one hash does not expose others

---
