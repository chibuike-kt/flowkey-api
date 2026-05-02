import { redis } from '../../common/utils/redis';
import { AppError, ErrorCode } from '../../common/errors/AppError';

export type LockoutFactor = 'passcode' | 'pin';


// Lockout thresholds


const PASSCODE_LOCKOUT_SCHEDULE = [
  { failureThreshold: 5, durationMs: 15 * 60 * 1000 }, // 15 min
  { failureThreshold: 10, durationMs: 60 * 60 * 1000 }, // 1 hr
  { failureThreshold: 15, durationMs: 24 * 60 * 60 * 1000 }, // 24 hr
] as const;

const PASSCODE_HARD_LOCK_AFTER_LOCKOUTS = 3;
const PIN_HARD_LOCK_FAILURES = 3;
const PIN_HARD_LOCK_AFTER_LOCKOUTS = 2;
const PIN_LOCK_DURATION_MS = 30 * 60 * 1000; // 30 min


// Key helpers


function failKey(userId: string, factor: LockoutFactor): string {
  return `lockout:${userId}:${factor}:fails`;
}

function untilKey(userId: string, factor: LockoutFactor): string {
  return `lockout:${userId}:${factor}:until`;
}


// Public API


/**
 * Assert the factor is not currently locked.
 * Checks Redis first (fast path), then falls back to checking DB state
 * via the provided dbCheck function.
 *
 * @throws AppError if locked
 */
export async function assertNotLocked(
  userId: string,
  factor: LockoutFactor,
  dbCheck: () => Promise<{ hard_locked: boolean; locked_until: Date | null }>,
): Promise<void> {
  // Fast path — Redis
  const untilVal = await redis.get(untilKey(userId, factor));
  if (untilVal) {
    const lockedUntil = parseInt(untilVal, 10);
    if (Date.now() < lockedUntil) {
      const remainingMs = lockedUntil - Date.now();
      const remainingMin = Math.ceil(remainingMs / 60_000);
      const code =
        factor === 'passcode' ? ErrorCode.PASSCODE_LOCKED : ErrorCode.TRANSACTION_PIN_LOCKED;
      throw new AppError(
        code,
        `Your ${factor === 'passcode' ? 'account' : 'PIN'} is temporarily locked. ` +
          `Try again in ${remainingMin} minute${remainingMin === 1 ? '' : 's'}.`,
      );
    }
  }

  // Fallback — DB check for hard locks (Redis may have been cleared)
  const dbState = await dbCheck();

  if (dbState.hard_locked) {
    const code =
      factor === 'passcode' ? ErrorCode.PASSCODE_LOCKED : ErrorCode.TRANSACTION_PIN_LOCKED;
    throw new AppError(
      code,
      factor === 'passcode'
        ? 'Your account is locked. Please contact support to unlock it.'
        : 'Your transaction PIN is locked. Please contact support or reset your PIN.',
    );
  }

  if (dbState.locked_until && dbState.locked_until > new Date()) {
    const remainingMs = dbState.locked_until.getTime() - Date.now();
    const remainingMin = Math.ceil(remainingMs / 60_000);
    const code =
      factor === 'passcode' ? ErrorCode.PASSCODE_LOCKED : ErrorCode.TRANSACTION_PIN_LOCKED;
    throw new AppError(
      code,
      `Your ${factor === 'passcode' ? 'account' : 'PIN'} is temporarily locked. ` +
        `Try again in ${remainingMin} minute${remainingMin === 1 ? '' : 's'}.`,
    );
  }
}

/**
 * Record a failed attempt. Applies lockout if threshold is reached.
 *
 * @param userId
 * @param factor
 * @param currentFailCount — current value from DB (passed in to avoid extra query)
 * @param currentLockoutCount — number of times this factor has been locked out
 * @returns Updated lockout state to persist to DB
 */
export async function recordFailedAttempt(
  userId: string,
  factor: LockoutFactor,
  currentFailCount: number,
  currentLockoutCount: number,
): Promise<{
  newFailCount: number;
  lockedUntil: Date | null;
  hardLocked: boolean;
  newLockoutCount: number;
}> {
  const newFailCount = currentFailCount + 1;

  if (factor === 'passcode') {
    return applyPasscodeLockout(userId, newFailCount, currentLockoutCount);
  } else {
    return applyPinLockout(userId, newFailCount, currentLockoutCount);
  }
}

/**
 * Clear lockout state after successful authentication.
 * Resets Redis keys and returns zeroed DB values.
 */
export async function clearLockout(
  userId: string,
  factor: LockoutFactor,
): Promise<{ newFailCount: number; lockedUntil: null; hardLocked: false }> {
  await redis.del(failKey(userId, factor), untilKey(userId, factor));
  return { newFailCount: 0, lockedUntil: null, hardLocked: false };
}


// Internal helpers


async function applyPasscodeLockout(
  userId: string,
  newFailCount: number,
  currentLockoutCount: number,
): Promise<{
  newFailCount: number;
  lockedUntil: Date | null;
  hardLocked: boolean;
  newLockoutCount: number;
}> {
  // Find applicable lockout schedule entry
  const schedule = [...PASSCODE_LOCKOUT_SCHEDULE]
    .reverse()
    .find((s) => newFailCount >= s.failureThreshold);

  if (!schedule) {
    // Below first threshold — just record the failure, no lock yet
    return {
      newFailCount,
      lockedUntil: null,
      hardLocked: false,
      newLockoutCount: currentLockoutCount,
    };
  }

  // Only apply lock when we hit a threshold exactly (not on every failure above it)
  const isNewLockout = PASSCODE_LOCKOUT_SCHEDULE.some((s) => s.failureThreshold === newFailCount);

  if (!isNewLockout) {
    // Already in a lockout tier — don't re-lock
    return {
      newFailCount,
      lockedUntil: null,
      hardLocked: false,
      newLockoutCount: currentLockoutCount,
    };
  }

  const newLockoutCount = currentLockoutCount + 1;
  const hardLocked = newLockoutCount >= PASSCODE_HARD_LOCK_AFTER_LOCKOUTS;

  if (hardLocked) {
    // Hard lock — clear Redis TTL-based lock, DB flag takes over
    await redis.del(untilKey(userId, 'passcode'));
    return { newFailCount, lockedUntil: null, hardLocked: true, newLockoutCount };
  }

  const lockedUntil = new Date(Date.now() + schedule.durationMs);
  const ttlSeconds = Math.ceil(schedule.durationMs / 1000);

  await redis.set(untilKey(userId, 'passcode'), lockedUntil.getTime().toString(), 'EX', ttlSeconds);

  return { newFailCount, lockedUntil, hardLocked: false, newLockoutCount };
}

async function applyPinLockout(
  userId: string,
  newFailCount: number,
  currentLockoutCount: number,
): Promise<{
  newFailCount: number;
  lockedUntil: Date | null;
  hardLocked: boolean;
  newLockoutCount: number;
}> {
  if (newFailCount < PIN_HARD_LOCK_FAILURES) {
    return {
      newFailCount,
      lockedUntil: null,
      hardLocked: false,
      newLockoutCount: currentLockoutCount,
    };
  }

  const newLockoutCount = currentLockoutCount + 1;
  const hardLocked = newLockoutCount >= PIN_HARD_LOCK_AFTER_LOCKOUTS;

  if (hardLocked) {
    await redis.del(untilKey(userId, 'pin'));
    return { newFailCount, lockedUntil: null, hardLocked: true, newLockoutCount };
  }

  const lockedUntil = new Date(Date.now() + PIN_LOCK_DURATION_MS);
  const ttlSeconds = Math.ceil(PIN_LOCK_DURATION_MS / 1000);

  await redis.set(untilKey(userId, 'pin'), lockedUntil.getTime().toString(), 'EX', ttlSeconds);

  return { newFailCount, lockedUntil, hardLocked: false, newLockoutCount };
}
