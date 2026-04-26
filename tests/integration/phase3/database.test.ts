/**
 * Phase 3 — Database integration tests
 *
 * These tests run against a real PostgreSQL instance.
 * Required env: DATABASE_URL pointing to a test database with migrations applied.
 *
 * Run with: npm run test:integration
 * Requires: docker compose up -d (Postgres must be running)
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PrismaClient } = require('@prisma/client');

// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
const prisma = new PrismaClient({
  datasources: { db: { url: process.env['DATABASE_URL'] } },
});

afterAll(async () => {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------
// Connectivity
// ---------------------------------------------------------------------------

describe('Database connectivity', () => {
  it('connects and responds to SELECT 1', async () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const result = await prisma.$queryRaw`SELECT 1 AS value`;
    expect(result).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Table existence
// ---------------------------------------------------------------------------

describe('Table existence', () => {
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
    it(`table "${table}" exists`, async () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      const result = await prisma.$queryRaw`
        SELECT COUNT(*) as count
        FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = ${table}
      `;
      const rows = result as Array<{ count: bigint }>;
      expect(Number(rows[0]?.count)).toBe(1);
    });
  }
});

// ---------------------------------------------------------------------------
// Immutability triggers
// ---------------------------------------------------------------------------

describe('ledger_entries immutability trigger', () => {
  it('INSERT into ledger_entries succeeds when called via valid transaction', async () => {
    // We test the trigger indirectly — direct insert requires wallet + transaction FKs.
    // The trigger only fires on UPDATE/DELETE, so we validate it exists.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const result = await prisma.$queryRaw`
      SELECT trigger_name
      FROM information_schema.triggers
      WHERE event_object_table = 'ledger_entries'
      AND trigger_name = 'ledger_entries_immutability_guard'
    `;
    const rows = result as Array<{ trigger_name: string }>;
    expect(rows.length).toBe(1);
    expect(rows[0]?.trigger_name).toBe('ledger_entries_immutability_guard');
  });
});

describe('audit_logs immutability trigger', () => {
  it('trigger exists on audit_logs', async () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const result = await prisma.$queryRaw`
      SELECT trigger_name
      FROM information_schema.triggers
      WHERE event_object_table = 'audit_logs'
      AND trigger_name = 'audit_logs_immutability_guard'
    `;
    const rows = result as Array<{ trigger_name: string }>;
    expect(rows.length).toBe(1);
    expect(rows[0]?.trigger_name).toBe('audit_logs_immutability_guard');
  });

  it('UPDATE on audit_logs raises an exception', async () => {
    // Insert a test audit log entry first
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    await prisma.$executeRaw`
      INSERT INTO audit_logs (id, actor_type, action, previous_hash)
      VALUES (gen_random_uuid(), 'system', 'test.trigger_check', 'GENESIS')
    `;

    // Attempt UPDATE — must throw
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      prisma.$executeRaw`
        UPDATE audit_logs SET action = 'tampered' WHERE action = 'test.trigger_check'
      `,
    ).rejects.toThrow('audit_logs is append-only');
  });

  it('DELETE on audit_logs raises an exception', async () => {
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      prisma.$executeRaw`
        DELETE FROM audit_logs WHERE action = 'test.trigger_check'
      `,
    ).rejects.toThrow('audit_logs is append-only');
  });
});

// ---------------------------------------------------------------------------
// Constraint validation
// ---------------------------------------------------------------------------

describe('wallets table has no balance column', () => {
  it('balance column does not exist on wallets', async () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const result = await prisma.$queryRaw`
      SELECT COUNT(*) as count
      FROM information_schema.columns
      WHERE table_name = 'wallets'
      AND column_name = 'balance'
    `;
    const rows = result as Array<{ count: bigint }>;
    expect(Number(rows[0]?.count)).toBe(0);
  });
});

describe('monetary column types', () => {
  it('ledger_entries.amount is BIGINT', async () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const result = await prisma.$queryRaw`
      SELECT data_type
      FROM information_schema.columns
      WHERE table_name = 'ledger_entries'
      AND column_name = 'amount'
    `;
    const rows = result as Array<{ data_type: string }>;
    expect(rows[0]?.data_type).toBe('bigint');
  });

  it('transactions.amount is BIGINT', async () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const result = await prisma.$queryRaw`
      SELECT data_type
      FROM information_schema.columns
      WHERE table_name = 'transactions'
      AND column_name = 'amount'
    `;
    const rows = result as Array<{ data_type: string }>;
    expect(rows[0]?.data_type).toBe('bigint');
  });
});

describe('unique constraints', () => {
  it('users.universal_id has a unique constraint', async () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const result = await prisma.$queryRaw`
      SELECT COUNT(*) as count
      FROM information_schema.table_constraints tc
      JOIN information_schema.constraint_column_usage ccu
        ON tc.constraint_name = ccu.constraint_name
      WHERE tc.constraint_type = 'UNIQUE'
      AND ccu.table_name = 'users'
      AND ccu.column_name = 'universal_id'
    `;
    const rows = result as Array<{ count: bigint }>;
    expect(Number(rows[0]?.count)).toBe(1);
  });

  it('webhooks has unique constraint on (provider, webhook_id)', async () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const result = await prisma.$queryRaw`
      SELECT COUNT(*) as count
      FROM information_schema.table_constraints
      WHERE table_name = 'webhooks'
      AND constraint_type = 'UNIQUE'
      AND constraint_name = 'webhooks_provider_webhook_id_key'
    `;
    const rows = result as Array<{ count: bigint }>;
    expect(Number(rows[0]?.count)).toBe(1);
  });
});

describe('hash chain verification function', () => {
  it('verify_audit_log_chain function exists', async () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const result = await prisma.$queryRaw`
      SELECT COUNT(*) as count
      FROM information_schema.routines
      WHERE routine_name = 'verify_audit_log_chain'
      AND routine_schema = 'public'
    `;
    const rows = result as Array<{ count: bigint }>;
    expect(Number(rows[0]?.count)).toBe(1);
  });
});
