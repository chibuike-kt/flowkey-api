# FlowKey — Security Decisions Log

Every security control, the threat it mitigates, and its residual risk.

---

## SEC-001 — Argon2id for PIN and Passcode Hashing

**Threat mitigated:** Offline brute force of stolen hash database (especially critical for low-entropy PINs)
**Control:** Argon2id, memory=64MB, iterations=3, parallelism=4, output=32B, salt=16B random
**Residual risk:** An attacker with a stolen hash and dedicated ASIC hardware could eventually crack 4-digit PINs. Mitigated by lockout policy — online brute force is blocked before any useful number of guesses.

---

## SEC-002 — RS256 JWT with Asymmetric Keys

**Threat mitigated:** Token forgery; symmetric key exposure
**Control:** Private key signs tokens; public key verifies. Private key never leaves the server. Keys stored in AWS Secrets Manager.
**Residual risk:** Key compromise requires rotation. Rotation strategy must be defined before Phase 5.

---

## SEC-003 — Refresh Token Rotation with Reuse Detection

**Threat mitigated:** Refresh token theft and silent session hijacking
**Control:** Every refresh issues a new token pair and invalidates the old refresh token immediately. Reuse of an already-rotated token triggers revocation of the entire session family for that device.
**Residual risk:** Within the 15-minute access token TTL window, a stolen access token is usable. Mitigated by device_id binding.

---

## SEC-004 — Append-Only Ledger with PostgreSQL Trigger

**Threat mitigated:** Retroactive ledger manipulation (internal or external)
**Control:** PostgreSQL trigger raises exception on any UPDATE or DELETE on `ledger_entries`. No application-layer control can be bypassed.
**Residual risk:** A DBA with superuser access could drop the trigger. Mitigated by audit trail and principle of least privilege on DB users.

---

## SEC-005 — Hash-Chained Audit Log

**Threat mitigated:** Silent deletion or modification of audit log entries
**Control:** Each audit log entry stores SHA-256(previous_entry.id + previous_entry.created_at). A gap or modification breaks the chain.
**Residual risk:** An attacker with DB write access could recompute the chain. Mitigated by periodic export of chain hashes to immutable storage (CloudWatch Logs or S3 with Object Lock).

---

## SEC-006 — HMAC-SHA256 Webhook Verification

**Threat mitigated:** Webhook spoofing — attacker sends fake provider events to manipulate transaction state
**Control:** All inbound webhooks verified via HMAC-SHA256 against provider webhook secret before any processing. Invalid webhooks rejected with 401, zero side effects.
**Residual risk:** Webhook secret compromise. Mitigated by AWS Secrets Manager and rotation capability.

---

## SEC-007 — Pessimistic Locking for Balance Mutations

**Threat mitigated:** Race condition / double spend — concurrent requests mutating the same wallet balance
**Control:** SELECT FOR UPDATE inside explicit DB transaction on every balance read that precedes a write.
**Residual risk:** Deadlock under extreme concurrency. Alert on deadlock events; Postgres will auto-rollback one party.

---

## SEC-008 — Idempotency Key with Payload Hash Validation

**Threat mitigated:** Replay attacks; idempotency bypass (same key, different payload)
**Control:** Idempotency key stored with SHA-256 hash of normalized request body. Key reuse with different payload → 422 + fraud flag, never re-execution.
**Residual risk:** Client generates predictable idempotency keys. Mitigated by requiring UUID v4 (validated by Zod schema).

---

## SEC-009 — Timing-Safe Recipient Lookup

**Threat mitigated:** Username / Universal ID enumeration via timing side-channel
**Control:** Recipient lookup queries execute regardless of existence. Response time and shape are identical whether recipient exists or not (artificial delay normalizes timing).
**Residual risk:** High-volume enumeration attempts. Mitigated by per-user rate limits and velocity monitoring.

---

## SEC-010 — Progressive Lockout for Login Passcode

**Threat mitigated:** Online brute force of login passcode
**Control:** 5 failed attempts → 15-minute lockout. Second lockout → 1-hour. Third lockout → 24-hour. After 3rd hard lock, admin unlock required. All events logged.
**Residual risk:** Attacker gets maximum 15 guesses across three lockout cycles before admin intervention. For a 6-digit PIN (1,000,000 combinations), this is negligible.

---

## SEC-011 — AES-256-GCM for Sensitive Fields at Rest

**Threat mitigated:** Database dump exposing bank account numbers and KYC verification data
**Control:** Bank account numbers and retained Prembly verification response data encrypted with AES-256-GCM before storage. Key stored in AWS Secrets Manager.
**Residual risk:** Key compromise. Mitigated by key rotation capability and AWS KMS for envelope encryption (Phase 20).

---

## SEC-012 — Zero Sensitive Error Leakage

**Threat mitigated:** Information disclosure via error messages (stack traces, internal codes, query details)
**Control:** All errors normalised to AppError instances before reaching the client. Global error handler enforces the standard error envelope. Unknown errors produce generic 500 only.
**Residual risk:** Developer accidentally creates a route that bypasses the error handler. Mitigated by linting rules and test coverage requirement.

---
