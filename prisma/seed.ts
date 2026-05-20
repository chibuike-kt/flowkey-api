import * as dotenv from 'dotenv';
dotenv.config();

import * as argon2 from 'argon2';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PrismaClient } = require('@prisma/client');
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
const prisma = new PrismaClient();

const ARGON2_PARAMS = {
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 4,
  hashLength: 32,
  type: argon2.argon2id,
};

const ARGON2_PARAMS_JSON = JSON.stringify({
  m: ARGON2_PARAMS.memoryCost,
  t: ARGON2_PARAMS.timeCost,
  p: ARGON2_PARAMS.parallelism,
  l: ARGON2_PARAMS.hashLength,
});

async function hashValue(value: string): Promise<string> {
  return argon2.hash(value, ARGON2_PARAMS);
}

async function main(): Promise<void> {
  if (process.env['NODE_ENV'] === 'production') {
    throw new Error('Seed must never run in production.');
  }

  console.warn('Seeding database — development only...');

  // ---------------------------------------------------------------------------
  // Super admin
  // ---------------------------------------------------------------------------
  const superAdminHash = await hashValue('SuperAdmin123!');

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const superAdmin = await prisma.admin.upsert({
    where: { email: 'superadmin@flowkey.internal' },
    update: {},
    create: {
      email: 'superadmin@flowkey.internal',
      display_name: 'Super Admin',
      role: 'super_admin',
      passcode_hash: superAdminHash,
      argon2_params: ARGON2_PARAMS_JSON,
      mfa_enabled: false,
      is_active: true,
    },
  });

  console.warn(`Super admin: ${superAdmin.id}`);

  // ---------------------------------------------------------------------------
  // Admin
  // ---------------------------------------------------------------------------
  const adminHash = await hashValue('Admin123!');

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const admin = await prisma.admin.upsert({
    where: { email: 'admin@flowkey.internal' },
    update: {},
    create: {
      email: 'admin@flowkey.internal',
      display_name: 'Admin User',
      role: 'admin',
      passcode_hash: adminHash,
      argon2_params: ARGON2_PARAMS_JSON,
      mfa_enabled: false,
      is_active: true,
    },
  });

  console.warn(`Admin: ${admin.id}`);

  // ---------------------------------------------------------------------------
  // Test user
  // ---------------------------------------------------------------------------
  const passcodeHash = await hashValue('123456');

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const testUser = await prisma.user.upsert({
    where: { email: 'test@flowkey.dev' },
    update: {},
    create: {
      phone: '+2348000000001',
      email: 'test@flowkey.dev',
      display_name: 'Test User',
      universal_id: 'SILVER-BOLT-0001',
      kyc_tier: 0,
      account_status: 'active',
      auth: {
        create: {
          login_passcode_hash: passcodeHash,
          argon2_params: ARGON2_PARAMS_JSON,
        },
      },
      wallet: {
        create: {},
      },
      notification_pref: {
        create: {},
      },
    },
  });

  console.warn(`Test user: ${testUser.id}`);

  // ---------------------------------------------------------------------------
  // Genesis audit log entry — origin of the hash chain
  // ---------------------------------------------------------------------------
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const existingGenesis = await prisma.auditLog.findFirst({
    where: { action: 'system.genesis' },
  });

  if (!existingGenesis) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    await prisma.auditLog.create({
      data: {
        actor_type: 'system',
        action: 'system.genesis',
        previous_hash: 'GENESIS',
        metadata: { note: 'Hash chain origin. This entry must never be deleted.' },
      },
    });
    console.warn('Genesis audit log entry created.');
  } else {
    console.warn('Genesis audit log entry already exists — skipped.');
  }

  console.warn('Seed complete.');
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  })
  .finally(() => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    void prisma.$disconnect();
  });
