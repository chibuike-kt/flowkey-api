/**
 * Phase 3 — Schema unit tests
 * Updated to find migration dynamically (DB was reset and remigrated).
 */
import * as fs from 'fs';
import * as path from 'path';

const migrationsDir = path.resolve(__dirname, '../../../prisma/migrations');
const schemaPath = path.resolve(__dirname, '../../../prisma/schema.prisma');

// Find the initial schema migration — it's the one with the most tables
function findInitialMigration(): string | null {
  if (!fs.existsSync(migrationsDir)) return null;
  const dirs = fs
    .readdirSync(migrationsDir)
    .filter((d) => fs.statSync(path.join(migrationsDir, d)).isDirectory())
    .sort();

  for (const dir of dirs) {
    const sqlPath = path.join(migrationsDir, dir, 'migration.sql');
    if (fs.existsSync(sqlPath)) {
      const content = fs.readFileSync(sqlPath, 'utf8');
      // The initial migration creates ledger_entries and audit_logs
      if (content.includes('ledger_entries') && content.includes('audit_logs')) {
        return sqlPath;
      }
    }
  }
  return null;
}

const migrationFile = findInitialMigration();

describe('Migration file', () => {
  it('at least one migration file exists', () => {
    expect(fs.existsSync(migrationsDir)).toBe(true);
    const dirs = fs
      .readdirSync(migrationsDir)
      .filter((d) => fs.statSync(path.join(migrationsDir, d)).isDirectory());
    expect(dirs.length).toBeGreaterThan(0);
  });

  it('initial schema migration.sql exists', () => {
    expect(migrationFile).not.toBeNull();
    expect(fs.existsSync(migrationFile!)).toBe(true);
  });

  it('enforces append-only ledger_entries', () => {
    const sql = fs.readFileSync(migrationFile!, 'utf8');
    expect(sql).toContain('enforce_ledger_immutability');
    expect(sql).toContain('ledger_entries_immutability_guard');
    expect(sql).toContain('BEFORE UPDATE OR DELETE ON "ledger_entries"');
  });

  it('enforces append-only audit_logs', () => {
    const sql = fs.readFileSync(migrationFile!, 'utf8');
    expect(sql).toContain('enforce_audit_log_immutability');
    expect(sql).toContain('audit_logs_immutability_guard');
    expect(sql).toContain('BEFORE UPDATE OR DELETE ON "audit_logs"');
  });

  it('contains audit chain verification function', () => {
    const sql = fs.readFileSync(migrationFile!, 'utf8');
    expect(sql).toContain('verify_audit_log_chain');
  });

  it('does NOT use floating point types for money', () => {
    const sql = fs.readFileSync(migrationFile!, 'utf8');
    expect(sql).not.toMatch(/"\w+"\s+FLOAT/);
    expect(sql).not.toMatch(/"\w+"\s+DECIMAL/);
    expect(sql).not.toMatch(/"\w+"\s+NUMERIC/);
    expect(sql).not.toMatch(/"\w+"\s+REAL/);
  });

  it('uses TIMESTAMPTZ (no naive TIMESTAMP)', () => {
    const sql = fs.readFileSync(migrationFile!, 'utf8');
    const stripped = sql.replace(/TIMESTAMPTZ/g, '');
    expect(stripped).not.toMatch(/\bTIMESTAMP\b/);
  });

  it('uses gen_random_uuid() for primary keys', () => {
    const sql = fs.readFileSync(migrationFile!, 'utf8');
    const tableCount = (sql.match(/CREATE TABLE/g) ?? []).length;
    const uuidCount = (sql.match(/DEFAULT gen_random_uuid\(\)/g) ?? []).length;
    expect(uuidCount).toBeGreaterThanOrEqual(tableCount);
  });

  it('enforces positive amount constraint', () => {
    const sql = fs.readFileSync(migrationFile!, 'utf8');
    expect(sql).toContain('"amount" > 0');
  });

  it('enforces non-negative fee constraint', () => {
    const sql = fs.readFileSync(migrationFile!, 'utf8');
    expect(sql).toContain('"fee" >= 0');
  });

  it('enforces kyc_tier bounds', () => {
    const sql = fs.readFileSync(migrationFile!, 'utf8');
    expect(sql).toContain('"kyc_tier" >= 0 AND "kyc_tier" <= 3');
  });

  it('includes all required tables', () => {
    const sql = fs.readFileSync(migrationFile!, 'utf8');
    const required = [
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
    for (const table of required) {
      expect(sql).toContain(`CREATE TABLE "${table}"`);
    }
  });

  it('wallets table has no balance column', () => {
    const sql = fs.readFileSync(migrationFile!, 'utf8');
    const match = sql.match(/CREATE TABLE "wallets" \([\s\S]*?\);/);
    expect(match).not.toBeNull();
    expect(match![0]).not.toContain('balance');
  });

  it('includes rollback strategy documentation', () => {
    const sql = fs.readFileSync(migrationFile!, 'utf8');
    expect(sql).toContain('ROLLBACK STRATEGY');
  });
});

describe('Prisma schema file', () => {
  it('schema.prisma exists', () => {
    expect(fs.existsSync(schemaPath)).toBe(true);
  });

  it('uses postgresql provider', () => {
    const schema = fs.readFileSync(schemaPath, 'utf8');
    expect(schema).toContain('"postgresql"');
  });

  it('uses DATABASE_URL env var', () => {
    const schema = fs.readFileSync(schemaPath, 'utf8');
    expect(schema).toContain('env("DATABASE_URL")');
  });

  it('uses SHADOW_DATABASE_URL for migrate dev', () => {
    const schema = fs.readFileSync(schemaPath, 'utf8');
    expect(schema).toContain('env("SHADOW_DATABASE_URL")');
  });

  it('prisma.config.ts does NOT exist — not a Prisma 6 concept', () => {
    const configPath = path.resolve(__dirname, '../../../prisma.config.ts');
    expect(fs.existsSync(configPath)).toBe(false);
  });
});
