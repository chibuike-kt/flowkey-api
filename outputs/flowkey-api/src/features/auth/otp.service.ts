/**
 * FlowKey — OTP Service
 *
 * Manages phone and email OTPs using Redis.
 *
 * Redis key structure:
 *   otp:{user_id}:{type}         → OTP value (TTL = OTP_TTL_SECONDS)
 *   otp:{user_id}:{type}:attempts → attempt count (TTL = OTP_TTL_SECONDS)
 *   otp:{user_id}:{type}:resend  → resend count (TTL = OTP_RESEND_WINDOW_SECONDS)
 *
 * Security invariants:
 *   - OTP is invalidated immediately when a resend is requested
 *   - Max 3 submission attempts before OTP is invalidated
 *   - Max 3 resends within 30-minute window
 *   - Constant-time comparison to prevent timing attacks
 */

import { timingSafeEqual } from 'crypto';
import { randomInt } from 'crypto';
import { redis } from '../../common/utils/redis';
import { config } from '../../config';
import { AppError, ErrorCode } from '../../common/errors/AppError';
import type { OtpType } from './auth.types';

// ---------------------------------------------------------------------------
// Key helpers
// ---------------------------------------------------------------------------

function otpKey(userId: string, type: OtpType): string {
  return `otp:${userId}:${type}`;
}

function attemptsKey(userId: string, type: OtpType): string {
  return `otp:${userId}:${type}:attempts`;
}

function resendKey(userId: string, type: OtpType): string {
  return `otp:${userId}:${type}:resend`;
}

// ---------------------------------------------------------------------------
// OTP generation
// ---------------------------------------------------------------------------

/**
 * Generate a cryptographically random 6-digit OTP.
 * Using randomInt (CSPRNG) — never Math.random().
 */
function generateOtpValue(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate and store a new OTP for the given user and type.
 * If an OTP already exists, it is overwritten (invalidated immediately).
 * Returns the OTP value — caller is responsible for sending it.
 */
export async function generateOtp(userId: string, type: OtpType): Promise<string> {
  const cfg = config();
  const otp = generateOtpValue();
  const key = otpKey(userId, type);
  const attKey = attemptsKey(userId, type);

  // Atomically set OTP and reset attempt counter
  const pipeline = redis.pipeline();
  pipeline.set(key, otp, 'EX', cfg.otpTtlSeconds);
  pipeline.del(attKey); // reset attempts on new OTP
  await pipeline.exec();

  return otp;
}

/**
 * Verify an OTP submission.
 * Uses constant-time comparison to prevent timing attacks.
 *
 * @throws AppError OTP_INVALID — wrong code
 * @throws AppError OTP_EXPIRED — OTP not found (expired or never issued)
 * @throws AppError OTP_MAX_ATTEMPTS_EXCEEDED — too many wrong attempts
 */
export async function verifyOtp(userId: string, type: OtpType, submitted: string): Promise<void> {
  const cfg = config();
  const key = otpKey(userId, type);
  const attKey = attemptsKey(userId, type);

  // Check attempt count first — fail fast before hitting the stored OTP
  const attempts = await redis.get(attKey);
  const attemptCount = attempts ? parseInt(attempts, 10) : 0;

  if (attemptCount >= cfg.otpMaxAttempts) {
    throw new AppError(
      ErrorCode.OTP_MAX_ATTEMPTS_EXCEEDED,
      'Too many incorrect attempts. Please request a new code.',
    );
  }

  const stored = await redis.get(key);

  if (!stored) {
    throw new AppError(
      ErrorCode.OTP_EXPIRED,
      'This code has expired or is invalid. Please request a new one.',
    );
  }

  // Constant-time comparison — both buffers must be same length
  const storedBuf = Buffer.from(stored.padEnd(6, '0'));
  const submittedBuf = Buffer.from(submitted.padEnd(6, '0'));
  const isValid = timingSafeEqual(storedBuf, submittedBuf) && stored === submitted;

  if (!isValid) {
    // Increment attempt counter with same TTL as the OTP
    const ttl = await redis.ttl(key);
    const remainingTtl = ttl > 0 ? ttl : cfg.otpTtlSeconds;
    await redis.set(attKey, (attemptCount + 1).toString(), 'EX', remainingTtl);

    const remaining = cfg.otpMaxAttempts - (attemptCount + 1);
    if (remaining <= 0) {
      // Invalidate the OTP entirely after max attempts
      await redis.del(key);
      throw new AppError(
        ErrorCode.OTP_MAX_ATTEMPTS_EXCEEDED,
        'Too many incorrect attempts. Please request a new code.',
      );
    }

    throw new AppError(ErrorCode.OTP_INVALID, 'The code you entered is incorrect.');
  }

  // Valid — delete OTP and attempt counter
  await redis.del(key, attKey);
}

/**
 * Request an OTP resend.
 * Rate limited: max OTP_RESEND_MAX within OTP_RESEND_WINDOW_SECONDS.
 * Previous OTP is invalidated immediately.
 *
 * @returns New OTP value — caller sends it.
 * @throws AppError OTP_RESEND_LIMIT_EXCEEDED
 */
export async function resendOtp(userId: string, type: OtpType): Promise<string> {
  const cfg = config();
  const rKey = resendKey(userId, type);

  // Check resend count
  const resendCount = await redis.get(rKey);
  const count = resendCount ? parseInt(resendCount, 10) : 0;

  if (count >= cfg.otpResendMax) {
    throw new AppError(
      ErrorCode.OTP_RESEND_LIMIT_EXCEEDED,
      'Too many resend attempts. Please wait before trying again.',
    );
  }

  // Invalidate existing OTP and attempt counter immediately
  const key = otpKey(userId, type);
  const attKey = attemptsKey(userId, type);
  await redis.del(key, attKey);

  // Generate new OTP
  const newOtp = await generateOtp(userId, type);

  // Increment resend counter — window is OTP_RESEND_WINDOW_SECONDS
  if (count === 0) {
    await redis.set(rKey, '1', 'EX', cfg.otpResendWindowSeconds);
  } else {
    await redis.incr(rKey);
    // Preserve existing TTL on the resend window key
  }

  return newOtp;
}

/**
 * Check whether an OTP exists for a user/type (without consuming it).
 * Used to determine OTP expiry timestamps for responses.
 */
export async function getOtpTtl(userId: string, type: OtpType): Promise<number> {
  const key = otpKey(userId, type);
  const ttl = await redis.ttl(key);
  return ttl > 0 ? ttl : 0;
}
