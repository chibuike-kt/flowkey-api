/**
 * Phase 3 — Schema unit tests (Prisma 6)
 *
 * Validates migration SQL correctness and Prisma schema structure
 * without requiring a database connection.
 */

import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const migrationDir = path.resolve(
  __dirname,
  '../../../prisma/migrations/20260425000000_phase3_initial_schema',
);

const migrationFile = path.join(migrationDir, 'migration.sql');
const schemaPath = path.resolve(__dirname, '../../../prisma/schema.prisma');

// ---------------------------------------------------------------------------
// Helpers (avoid re-reading file repeatedly)
// ---------------------------------------------------------------------------

const readMigration = () => fs.readFileSync(migrationFile, 'utf8');
const readSchema = () => fs.readFileSync(schemaPath, 'utf8');

// ---------------------------------------------------------------------------
// Migration file tests
// ---------------------------------------------------------------------------

describe('Migration file', () => {
  it('migration directory exists', () => {
    expect(fs.existsSync(migrationDir)).toBe(true);
  });

  it('migration.sql exists', () => {
    expect(fs.existsSync(migrationFile)).toBe(true);
  });

  it('enforces append-only ledger_entries', () => {
    const sql = readMigration();
    expect(sql).toContain('ledger_entries_immutability_guard');
    expect(sql).toContain('BEFORE UPDATE OR DELETE ON "ledger_entries"');
  });

  it('enforces append-only audit_logs', () => {
    const sql = readMigration();
    expect(sql).toContain('audit_logs_immutability_guard');
    expect(sql).toContain('BEFORE UPDATE OR DELETE ON "audit_logs"');
  });

  it('contains audit chain verification function', () => {
    const sql = readMigration();
    expect(sql).toContain('verify_audit_log_chain');
  });

  it('does NOT use floating point types for money', () => {
    const sql = readMigration();

    expect(sql).not.toMatch(/\bFLOAT\b/i);
    expect(sql).not.toMatch(/\bREAL\b/i);
    expect(sql).not.toMatch(/\bDOUBLE PRECISION\b/i);
    expect(sql).not.toMatch(/\bNUMERIC\b/i);
    expect(sql).not.toMatch(/\bDECIMAL\b/i);
  });

  it('uses TIMESTAMPTZ (no naive TIMESTAMP)', () => {
    const sql = readMigration();

    // allow TIMESTAMPTZ only
    expect(sql).not.toMatch(/\bTIMESTAMP(?!TZ)\b/);
  });

  it('uses gen_random_uuid() for primary keys', () => {
    const sql = readMigration();

    const tableCount = (sql.match(/CREATE TABLE/g) ?? []).length;
    const uuidCount = (sql.match(/gen_random_uuid\(\)/g) ?? []).length;

    expect(uuidCount).toBeGreaterThanOrEqual(tableCount);
  });

  it('enforces positive amount constraint', () => {
    const sql = readMigration();
    expect(sql).toContain('"amount" > 0');
  });

  it('enforces non-negative fee constraint', () => {
    const sql = readMigration();
    expect(sql).toContain('"fee" >= 0');
  });

  it('enforces kyc_tier bounds', () => {
    const sql = readMigration();
    expect(sql).toContain('"kyc_tier" >= 0 AND "kyc_tier" <= 3');
  });

  it('includes all required tables', () => {
    const sql = readMigration();

    const requiredTables = [
      'users',
      'user_auth',
      'admins',
      'admin_sessions',
      'wallets',
      'ledger_entries',
      'transactions',
      'transaction_fees',
      'idempotency_keys',
      'receipts',
      'device_sessions',
      'kyc_attempts',
      'beneficiaries',
      'payment_requests',
      'notifications',
      'notification_prefs',
      'conversations',
      'webhooks',
      'disputes',
      'reversals',
      'admin_actions',
      'qr_codes',
      'audit_logs',
    ];

    for (const table of requiredTables) {
      expect(sql).toContain(`CREATE TABLE "${table}"`);
    }
  });

  it('wallets table has no balance column', () => {
    const sql = readMigration();

    const match = sql.match(/CREATE TABLE "wallets" \([\s\S]*?\);/);
    expect(match).not.toBeNull();

    expect(match![0]).not.toMatch(/\bbalance\b/);
  });

  it('includes rollback strategy documentation', () => {
    const sql = readMigration();
    expect(sql).toMatch(/ROLLBACK STRATEGY/i);
  });
});

// ---------------------------------------------------------------------------
// Prisma schema tests (Prisma 6)
// ---------------------------------------------------------------------------

describe('Prisma schema file', () => {
  it('schema.prisma exists', () => {
    expect(fs.existsSync(schemaPath)).toBe(true);
  });

  it('uses postgresql provider', () => {
    const schema = readSchema();
    expect(schema).toContain('provider = "postgresql"');
  });

  it('uses DATABASE_URL env var', () => {
    const schema = readSchema();
    expect(schema).toContain('env("DATABASE_URL")');
  });

  it('uses SHADOW_DATABASE_URL for migrate dev', () => {
    const schema = readSchema();
    expect(schema).toContain('env("SHADOW_DATABASE_URL")');
  });
});
