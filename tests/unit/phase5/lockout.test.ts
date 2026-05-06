// Must be set before jest.mock() factory runs (hoisting safe via global)
(global as Record<string, unknown>).__lockoutStore = {} as Record<string, string>;

jest.mock('../../../src/common/utils/redis', () => ({
  redis: {
    get: jest.fn((k: string) =>
      Promise.resolve(
        ((global as Record<string, unknown>).__lockoutStore as Record<string, string>)[k] ?? null,
      ),
    ),
    set: jest.fn((k: string, v: string) => {
      ((global as Record<string, unknown>).__lockoutStore as Record<string, string>)[k] = v;
      return Promise.resolve('OK');
    }),
    setex: jest.fn((k: string, _t: number, v: string) => {
      ((global as Record<string, unknown>).__lockoutStore as Record<string, string>)[k] = v;
      return Promise.resolve('OK');
    }),
    del: jest.fn((...keys: string[]) => {
      const store = (global as Record<string, unknown>).__lockoutStore as Record<string, string>;
      const flat = keys.flat() as string[];
      flat.forEach((k: string) => delete store[k]);
      return Promise.resolve(flat.length);
    }),
  },
}));

import {
  assertNotLocked,
  recordFailedAttempt,
  clearLockout,
} from '../../../src/features/auth/lockout.service';

// Shorthand to access the store
function getStore(): Record<string, string> {
  return (global as Record<string, unknown>).__lockoutStore as Record<string, string>;
}

beforeEach(() => {
  const store = getStore();
  Object.keys(store).forEach((k) => delete store[k]);
});

const unlockedDb = async () => ({ hard_locked: false, locked_until: null });

// ---------------------------------------------------------------------------
// assertNotLocked
// ---------------------------------------------------------------------------

describe('assertNotLocked', () => {
  it('passes when no lock exists in Redis and DB shows unlocked', async () => {
    await expect(assertNotLocked('user-1', 'passcode', unlockedDb)).resolves.toBeUndefined();
  });

  it('throws PASSCODE_LOCKED when Redis shows an active lock', async () => {
    // lockout service stores epoch ms as string under key: lockout:{userId}:{factor}:until
    getStore()['lockout:user-locked:passcode:until'] = String(Date.now() + 60_000);
    await expect(assertNotLocked('user-locked', 'passcode', unlockedDb)).rejects.toMatchObject({
      code: 'PASSCODE_LOCKED',
    });
  });

  it('passes when Redis lock timestamp is in the past', async () => {
    getStore()['lockout:user-past:passcode:until'] = String(Date.now() - 60_000);
    await expect(assertNotLocked('user-past', 'passcode', unlockedDb)).resolves.toBeUndefined();
  });

  it('throws PASSCODE_LOCKED when DB reports hard lock', async () => {
    const hardLocked = async () => ({ hard_locked: true, locked_until: null });
    await expect(assertNotLocked('user-hard', 'passcode', hardLocked)).rejects.toMatchObject({
      code: 'PASSCODE_LOCKED',
    });
  });

  it('throws TRANSACTION_PIN_LOCKED for pin factor with hard lock', async () => {
    const hardLocked = async () => ({ hard_locked: true, locked_until: null });
    await expect(assertNotLocked('user-pin', 'pin', hardLocked)).rejects.toMatchObject({
      code: 'TRANSACTION_PIN_LOCKED',
    });
  });

  it('throws PASSCODE_LOCKED when DB locked_until is in the future', async () => {
    const futureDb = async () => ({
      hard_locked: false,
      locked_until: new Date(Date.now() + 10 * 60 * 1000),
    });
    await expect(assertNotLocked('user-db-locked', 'passcode', futureDb)).rejects.toMatchObject({
      code: 'PASSCODE_LOCKED',
    });
  });
});

// ---------------------------------------------------------------------------
// recordFailedAttempt — passcode
// ---------------------------------------------------------------------------

describe('recordFailedAttempt — passcode', () => {
  it('returns no lock before first threshold (< 5 failures)', async () => {
    const result = await recordFailedAttempt('user-1', 'passcode', 3, 0);
    expect(result.lockedUntil).toBeNull();
    expect(result.hardLocked).toBe(false);
  });

  it('applies 15-minute lock at exactly 5 failures', async () => {
    const result = await recordFailedAttempt('user-1', 'passcode', 4, 0);
    expect(result.lockedUntil).not.toBeNull();
    const diffMs = result.lockedUntil!.getTime() - Date.now();
    expect(diffMs).toBeGreaterThan(14 * 60 * 1000);
    expect(diffMs).toBeLessThan(16 * 60 * 1000);
  });

  it('applies 1-hour lock at exactly 10 failures', async () => {
    const result = await recordFailedAttempt('user-1', 'passcode', 9, 1);
    expect(result.lockedUntil).not.toBeNull();
    const diffMs = result.lockedUntil!.getTime() - Date.now();
    expect(diffMs).toBeGreaterThan(59 * 60 * 1000);
    expect(diffMs).toBeLessThan(61 * 60 * 1000);
  });

  it('applies hard lock at 3rd lockout event (15 failures)', async () => {
    const result = await recordFailedAttempt('user-1', 'passcode', 14, 2);
    expect(result.hardLocked).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// recordFailedAttempt — PIN
// ---------------------------------------------------------------------------

describe('recordFailedAttempt — PIN', () => {
  it('returns no lock before 3 failures', async () => {
    const result = await recordFailedAttempt('user-1', 'pin', 1, 0);
    expect(result.lockedUntil).toBeNull();
    expect(result.hardLocked).toBe(false);
  });

  it('applies 30-minute lock at exactly 3 failures (first lockout)', async () => {
    const result = await recordFailedAttempt('user-1', 'pin', 2, 0);
    expect(result.lockedUntil).not.toBeNull();
    const diffMs = result.lockedUntil!.getTime() - Date.now();
    expect(diffMs).toBeGreaterThan(29 * 60 * 1000);
    expect(diffMs).toBeLessThan(31 * 60 * 1000);
  });

  it('applies hard lock at 2nd lockout event', async () => {
    const result = await recordFailedAttempt('user-1', 'pin', 2, 1);
    expect(result.hardLocked).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// clearLockout
// ---------------------------------------------------------------------------

describe('clearLockout', () => {
  it('returns zeroed state', async () => {
    const result = await clearLockout('user-clear', 'passcode');
    expect(result.newFailCount).toBe(0);
    expect(result.lockedUntil).toBeNull();
    expect(result.hardLocked).toBe(false);
  });

  it('calls redis.del to remove lock keys', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { redis } = require('../../../src/common/utils/redis') as { redis: { del: jest.Mock } };
    await clearLockout('user-del', 'passcode');
    expect(redis.del).toHaveBeenCalled();
  });
});
