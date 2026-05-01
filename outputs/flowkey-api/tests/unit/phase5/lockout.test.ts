/**
 * Phase 5 — Lockout service unit tests
 * Redis is mocked via jest.mock
 */

jest.mock('../../../src/common/utils/redis', () => ({
  redis: {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    incr: jest.fn(),
    ttl: jest.fn(),
    pipeline: jest.fn(),
    quit: jest.fn(),
    ping: jest.fn(),
  },
}));

import { redis } from '../../../src/common/utils/redis';
import {
  assertNotLocked,
  recordFailedAttempt,
  clearLockout,
} from '../../../src/features/auth/lockout.service';
import { AppError, ErrorCode } from '../../../src/common/errors/AppError';

const mockRedis = redis as jest.Mocked<typeof redis>;

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// assertNotLocked
// ---------------------------------------------------------------------------

describe('assertNotLocked', () => {
  it('passes when no lock exists in Redis and DB shows unlocked', async () => {
    mockRedis.get.mockResolvedValue(null);
    await expect(
      assertNotLocked('user-1', 'passcode', () =>
        Promise.resolve({ hard_locked: false, locked_until: null }),
      ),
    ).resolves.not.toThrow();
  });

  it('throws PASSCODE_LOCKED when Redis shows active lock', async () => {
    const futureMs = (Date.now() + 900_000).toString(); // 15 min from now
    mockRedis.get.mockResolvedValue(futureMs);

    await expect(
      assertNotLocked('user-1', 'passcode', () =>
        Promise.resolve({ hard_locked: false, locked_until: null }),
      ),
    ).rejects.toMatchObject({ code: ErrorCode.PASSCODE_LOCKED });
  });

  it('passes when Redis lock has expired (past timestamp)', async () => {
    const pastMs = (Date.now() - 1000).toString(); // 1 second ago
    mockRedis.get.mockResolvedValue(pastMs);

    await expect(
      assertNotLocked('user-1', 'passcode', () =>
        Promise.resolve({ hard_locked: false, locked_until: null }),
      ),
    ).resolves.not.toThrow();
  });

  it('throws PASSCODE_LOCKED when DB shows hard lock', async () => {
    mockRedis.get.mockResolvedValue(null);

    await expect(
      assertNotLocked('user-1', 'passcode', () =>
        Promise.resolve({ hard_locked: true, locked_until: null }),
      ),
    ).rejects.toMatchObject({ code: ErrorCode.PASSCODE_LOCKED });
  });

  it('throws TRANSACTION_PIN_LOCKED for pin factor', async () => {
    mockRedis.get.mockResolvedValue(null);

    await expect(
      assertNotLocked('user-1', 'pin', () =>
        Promise.resolve({ hard_locked: true, locked_until: null }),
      ),
    ).rejects.toMatchObject({ code: ErrorCode.TRANSACTION_PIN_LOCKED });
  });
});

// ---------------------------------------------------------------------------
// recordFailedAttempt — passcode
// ---------------------------------------------------------------------------

describe('recordFailedAttempt — passcode', () => {
  beforeEach(() => {
    mockRedis.set.mockResolvedValue('OK');
    mockRedis.del.mockResolvedValue(1);
  });

  it('returns no lock before first threshold (< 5 failures)', async () => {
    const result = await recordFailedAttempt('user-1', 'passcode', 3, 0);
    expect(result.newFailCount).toBe(4);
    expect(result.lockedUntil).toBeNull();
    expect(result.hardLocked).toBe(false);
  });

  it('applies 15-minute lock at exactly 5 failures', async () => {
    const result = await recordFailedAttempt('user-1', 'passcode', 4, 0);
    expect(result.newFailCount).toBe(5);
    expect(result.lockedUntil).not.toBeNull();
    expect(result.newLockoutCount).toBe(1);
    expect(mockRedis.set).toHaveBeenCalled();
  });

  it('applies 1-hour lock at exactly 10 failures', async () => {
    const result = await recordFailedAttempt('user-1', 'passcode', 9, 1);
    expect(result.newFailCount).toBe(10);
    expect(result.lockedUntil).not.toBeNull();
    expect(result.newLockoutCount).toBe(2);
  });

  it('applies hard lock at 3rd lockout event (15 failures)', async () => {
    const result = await recordFailedAttempt('user-1', 'passcode', 14, 2);
    expect(result.newFailCount).toBe(15);
    expect(result.hardLocked).toBe(true);
    expect(result.newLockoutCount).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// recordFailedAttempt — PIN
// ---------------------------------------------------------------------------

describe('recordFailedAttempt — PIN', () => {
  beforeEach(() => {
    mockRedis.set.mockResolvedValue('OK');
    mockRedis.del.mockResolvedValue(1);
  });

  it('returns no lock before 3 failures', async () => {
    const result = await recordFailedAttempt('user-1', 'pin', 1, 0);
    expect(result.newFailCount).toBe(2);
    expect(result.lockedUntil).toBeNull();
    expect(result.hardLocked).toBe(false);
  });

  it('applies 30-minute lock at exactly 3 failures (first lockout)', async () => {
    const result = await recordFailedAttempt('user-1', 'pin', 2, 0);
    expect(result.newFailCount).toBe(3);
    expect(result.lockedUntil).not.toBeNull();
    expect(result.hardLocked).toBe(false);
    expect(result.newLockoutCount).toBe(1);
  });

  it('applies hard lock at 2nd lockout event', async () => {
    const result = await recordFailedAttempt('user-1', 'pin', 2, 1);
    expect(result.newFailCount).toBe(3);
    expect(result.hardLocked).toBe(true);
    expect(result.newLockoutCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// clearLockout
// ---------------------------------------------------------------------------

describe('clearLockout', () => {
  it('deletes Redis keys and returns zeroed state', async () => {
    mockRedis.del.mockResolvedValue(2);
    const result = await clearLockout('user-1', 'passcode');
    expect(result.newFailCount).toBe(0);
    expect(result.lockedUntil).toBeNull();
    expect(result.hardLocked).toBe(false);
    expect(mockRedis.del).toHaveBeenCalled();
  });
});
