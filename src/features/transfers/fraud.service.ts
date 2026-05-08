import { redis } from '../../common/utils/redis';
import { logger } from '../../common/utils/logger';
import { AppError, ErrorCode } from '../../common/errors/AppError';
import type { FraudCheckResult } from './transfers.types';

// Velocity window — 1 hour in seconds
const VELOCITY_WINDOW_SECONDS = 3600;

// Hard limits
const MAX_INTERNAL_PER_HOUR = 10;
const MAX_UID_AUTH_PER_HOUR = 3;
const MAX_BANK_PER_HOUR = 5;

// Soft flag thresholds
const LARGE_TRANSFER_THRESHOLD_KOBO = 50_000_000; // ₦500k

// ---------------------------------------------------------------------------
// Internal transfer fraud check
// ---------------------------------------------------------------------------

export async function checkInternalTransferFraud(
  senderWalletId: string,
  amountKobo: bigint,
  source: string,
  uid?: string,
): Promise<FraudCheckResult> {
  const now = Math.floor(Date.now() / 1000);
  let blocked = false;
  let reason: string | undefined;
  let flagged = false;
  let flagReason: string | undefined;

  // 1. Internal velocity check
  const velocityKey = `fraud:velocity:internal:${senderWalletId}`;
  const velocityCount = await incrementVelocity(velocityKey, now);

  if (velocityCount > MAX_INTERNAL_PER_HOUR) {
    blocked = true;
    reason = `Transfer velocity limit exceeded. Maximum ${MAX_INTERNAL_PER_HOUR} transfers per hour.`;
    logger.warn('Fraud: internal transfer velocity exceeded', {
      sender_wallet_id: senderWalletId,
      velocity_count: velocityCount,
    });
  }

  // 2. UID-auth velocity check — stricter (prevents brute-force UID targeting)
  if (!blocked && source === 'universal_id' && uid) {
    const uidVelocityKey = `fraud:velocity:uid:${uid}`;
    const uidVelocityCount = await incrementVelocity(uidVelocityKey, now);

    if (uidVelocityCount > MAX_UID_AUTH_PER_HOUR) {
      blocked = true;
      reason = `UID authentication transfer limit exceeded. Maximum ${MAX_UID_AUTH_PER_HOUR} per hour.`;
      logger.warn('Fraud: UID-auth velocity exceeded', {
        uid,
        velocity_count: uidVelocityCount,
      });
    }
  }

  // 3. Large transfer flag
  if (!blocked && amountKobo > BigInt(LARGE_TRANSFER_THRESHOLD_KOBO)) {
    flagged = true;
    flagReason = `Large transfer: ₦${(Number(amountKobo) / 100).toLocaleString()} exceeds ₦500k flag threshold`;
    logger.warn('Fraud flag: large internal transfer', {
      sender_wallet_id: senderWalletId,
      amount_kobo: amountKobo.toString(),
    });
  }

  if (blocked) {
    throw new AppError(ErrorCode.RATE_LIMITED, reason!);
  }

  return {
    blocked: false,
    flagged,
    flag_reason: flagReason,
    velocity_count: velocityCount,
  };
}

// ---------------------------------------------------------------------------
// Bank transfer fraud check
// ---------------------------------------------------------------------------

export async function checkBankTransferFraud(
  senderWalletId: string,
  amountKobo: bigint,
): Promise<FraudCheckResult> {
  const now = Math.floor(Date.now() / 1000);

  // Bank transfer velocity — stricter than internal
  const velocityKey = `fraud:velocity:bank:${senderWalletId}`;
  const velocityCount = await incrementVelocity(velocityKey, now);

  if (velocityCount > MAX_BANK_PER_HOUR) {
    logger.warn('Fraud: bank transfer velocity exceeded', {
      sender_wallet_id: senderWalletId,
      velocity_count: velocityCount,
    });
    throw new AppError(
      ErrorCode.RATE_LIMITED,
      `Bank transfer velocity limit exceeded. Maximum ${MAX_BANK_PER_HOUR} per hour.`,
    );
  }

  let flagged = false;
  let flagReason: string | undefined;

  if (amountKobo > BigInt(LARGE_TRANSFER_THRESHOLD_KOBO)) {
    flagged = true;
    flagReason = `Large bank transfer: ₦${(Number(amountKobo) / 100).toLocaleString()}`;
    logger.warn('Fraud flag: large bank transfer', {
      sender_wallet_id: senderWalletId,
      amount_kobo: amountKobo.toString(),
    });
  }

  return {
    blocked: false,
    flagged,
    flag_reason: flagReason,
    velocity_count: velocityCount,
  };
}

// ---------------------------------------------------------------------------
// Redis sliding window velocity counter
// Uses a sorted set: member = event timestamp, score = timestamp
// Entries older than VELOCITY_WINDOW_SECONDS are pruned on each call
// ---------------------------------------------------------------------------

async function incrementVelocity(key: string, nowSeconds: number): Promise<number> {
  const windowStart = nowSeconds - VELOCITY_WINDOW_SECONDS;
  const member = `${nowSeconds}:${Math.random().toString(36).slice(2)}`;

  try {
    const pipeline = redis.pipeline();
    pipeline.zremrangebyscore(key, '-inf', windowStart);
    pipeline.zadd(key, nowSeconds, member);
    pipeline.zcard(key);
    pipeline.expire(key, VELOCITY_WINDOW_SECONDS + 60); // +60s buffer
    const results = await pipeline.exec();

    // zcard result is at index 2 in pipeline results
    const cardResult = results?.[2];
    if (cardResult && Array.isArray(cardResult) && typeof cardResult[1] === 'number') {
      return cardResult[1] as number;
    }
    return 1;
  } catch (err) {
    // Redis failure is non-fatal for fraud checks — fail open, log it
    logger.error('Fraud velocity check Redis error', {
      key,
      error: err instanceof Error ? err.message : String(err),
    });
    return 0;
  }
}
