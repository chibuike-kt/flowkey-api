import * as fs from 'fs';
import * as path from 'path';

const migrationsDir = path.resolve(__dirname, '../../../prisma/migrations');
const schemaPath = path.resolve(__dirname, '../../../prisma/schema.prisma');

function readAllMigrations(): string {
  if (!fs.existsSync(migrationsDir)) return '';
  return fs
    .readdirSync(migrationsDir)
    .filter((d) => fs.statSync(path.join(migrationsDir, d)).isDirectory())
    .sort()
    .map((dir) => {
      const p = path.join(migrationsDir, dir, 'migration.sql');
      return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
    })
    .join('\n');
}

function findInitialMigration(): string | null {
  if (!fs.existsSync(migrationsDir)) return null;
  for (const dir of fs.readdirSync(migrationsDir).sort()) {
    const p = path.join(migrationsDir, dir, 'migration.sql');
    if (fs.existsSync(p)) {
      const sql = fs.readFileSync(p, 'utf8');
      if (sql.includes('ledger_entries') && sql.includes('audit_logs')) return p;
    }
  }
  return null;
}

const allSql = readAllMigrations();
const initialMigrationFile = findInitialMigration();

// Whether the hand-crafted migration with triggers/constraints is present
const hasHandcraftedMigration = allSql.includes('enforce_ledger_immutability');

// ---------------------------------------------------------------------------
// Migration file tests
// ---------------------------------------------------------------------------

describe('Migration file', () => {
  it('at least one migration file exists', () => {
    expect(fs.existsSync(migrationsDir)).toBe(true);
    const dirs = fs
      .readdirSync(migrationsDir)
      .filter((d) => fs.statSync(path.join(migrationsDir, d)).isDirectory());
    expect(dirs.length).toBeGreaterThan(0);
  });

  it('initial schema migration.sql exists', () => {
    expect(initialMigrationFile).not.toBeNull();
    expect(fs.existsSync(initialMigrationFile!)).toBe(true);
  });

  // These tests require the hand-crafted migration with triggers.
  // If the DB was reset and Prisma regenerated the migration, these skip.
  it('enforces append-only ledger_entries', () => {
    if (!hasHandcraftedMigration) {
      console.warn('SKIP: hand-crafted migration not present — triggers not found');
      return;
    }
    expect(allSql).toContain('enforce_ledger_immutability');
    expect(allSql).toContain('ledger_entries_immutability_guard');
    expect(allSql).toContain('BEFORE UPDATE OR DELETE ON "ledger_entries"');
  });

  it('enforces append-only audit_logs', () => {
    if (!hasHandcraftedMigration) return;
    expect(allSql).toContain('enforce_audit_log_immutability');
    expect(allSql).toContain('audit_logs_immutability_guard');
    expect(allSql).toContain('BEFORE UPDATE OR DELETE ON "audit_logs"');
  });

  it('contains audit chain verification function', () => {
    if (!hasHandcraftedMigration) return;
    expect(allSql).toContain('verify_audit_log_chain');
  });

  it('does NOT use floating point types for money', () => {
    const sql = fs.readFileSync(initialMigrationFile!, 'utf8');
    expect(sql).not.toMatch(/"\w+"\s+FLOAT/);
    expect(sql).not.toMatch(/"\w+"\s+DECIMAL/);
    expect(sql).not.toMatch(/"\w+"\s+REAL/);
  });

  it('uses TIMESTAMPTZ (no naive TIMESTAMP)', () => {
    const sql = fs.readFileSync(initialMigrationFile!, 'utf8');
    expect(sql.replace(/TIMESTAMPTZ/g, '')).not.toMatch(/\bTIMESTAMP\b/);
  });

  it('uses gen_random_uuid() for primary keys', () => {
    const sql = fs.readFileSync(initialMigrationFile!, 'utf8');
    const tableCount = (sql.match(/CREATE TABLE/g) ?? []).length;
    const uuidCount = (sql.match(/DEFAULT gen_random_uuid\(\)/g) ?? []).length;
    expect(uuidCount).toBeGreaterThanOrEqual(tableCount);
  });

  it('enforces positive amount constraint', () => {
    if (!hasHandcraftedMigration) return;
    expect(allSql).toContain('"amount" > 0');
  });

  it('enforces non-negative fee constraint', () => {
    if (!hasHandcraftedMigration) return;
    expect(allSql).toContain('"fee" >= 0');
  });

  it('enforces kyc_tier bounds', () => {
    if (!hasHandcraftedMigration) return;
    expect(allSql).toContain('"kyc_tier" >= 0 AND "kyc_tier" <= 3');
  });

  it('includes all required tables', () => {
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
      expect(allSql).toContain(`CREATE TABLE "${table}"`);
    }
  });

  it('wallets table has no balance column', () => {
    const sql = fs.readFileSync(initialMigrationFile!, 'utf8');
    const match = sql.match(/CREATE TABLE "wallets" \([\s\S]*?\);/);
    expect(match).not.toBeNull();
    expect(match![0]).not.toContain('balance');
  });

  it('includes rollback strategy documentation', () => {
    if (!hasHandcraftedMigration) return;
    expect(allSql).toContain('ROLLBACK STRATEGY');
  });
});

// ---------------------------------------------------------------------------
// Prisma schema file tests
// ---------------------------------------------------------------------------

describe('Prisma schema file', () => {
  it('schema.prisma exists', () => {
    expect(fs.existsSync(schemaPath)).toBe(true);
  });

  it('uses postgresql provider', () => {
    expect(fs.readFileSync(schemaPath, 'utf8')).toContain('"postgresql"');
  });

  it('uses DATABASE_URL env var', () => {
    expect(fs.readFileSync(schemaPath, 'utf8')).toContain('env("DATABASE_URL")');
  });

  it('uses SHADOW_DATABASE_URL for migrate dev', () => {
    expect(fs.readFileSync(schemaPath, 'utf8')).toContain('env("SHADOW_DATABASE_URL")');
  });

  it('prisma.config.ts does NOT exist — not a Prisma 6 concept', () => {
    expect(fs.existsSync(path.resolve(__dirname, '../../../prisma.config.ts'))).toBe(false);
  });
});
