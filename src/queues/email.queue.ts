import { emailQueue } from './index';
import { logger } from '../common/utils/logger';
import { AppError, ErrorCode } from '../common/errors/AppError';
import type {
  OtpEmailJob,
  WelcomeEmailJob,
  PasscodeChangedEmailJob,
  NewDeviceLoginEmailJob,
  KycResultEmailJob,
} from './jobs';

const isProduction = process.env['NODE_ENV'] === 'production';

/** Replace all colons with hyphens — BullMQ rejects jobIds containing ":" */
function safeJobId(key: string): string {
  return key.replace(/:/g, '-');
}

function handleQueueError(err: unknown, context: Record<string, unknown>): void {
  const message = err instanceof Error ? err.message : String(err);
  logger.error('Email queue: failed to enqueue job', { ...context, error: message });

  if (isProduction) {
    throw new AppError(
      ErrorCode.EXTERNAL_SERVICE_ERROR,
      'Notification service temporarily unavailable. Please try again.',
    );
  }

  logger.warn('DEV: email queue error — continuing without delivery', context);
}

// ---------------------------------------------------------------------------
// OTP email — timestamp suffix prevents legitimate duplicate suppression
// ---------------------------------------------------------------------------

export async function queueOtpEmail(
  to: string,
  otp: string,
  purpose: OtpEmailJob['purpose'],
  userId: string,
): Promise<void> {
  const dedup_key = `otp-${userId}-${purpose}-${otp}`;
  const jobId = safeJobId(`${dedup_key}-${Date.now()}`);
  const payload: OtpEmailJob = { name: 'send-otp', to, otp, purpose, dedup_key };

  try {
    await emailQueue.add('send-otp', payload, { jobId });
    logger.info('Email job queued: send-otp', { userId, purpose, dedup_key, jobId });
  } catch (err) {
    if (!isProduction) {
      // ─────────────────────────────────────────────────────────────────────
      // DEV FALLBACK — queue unavailable (Redis not running?)
      // OTP is logged in plain text so testing can continue without Redis.
      // This block NEVER executes in production.
      // ─────────────────────────────────────────────────────────────────────
      logger.warn('═══════════════════════════════════════════════════════');
      logger.warn('DEV OTP FALLBACK — queue unavailable, logging OTP here');
      logger.warn(`  to:      ${to}`);
      logger.warn(`  purpose: ${purpose}`);
      logger.warn(`  OTP:     ${otp}`);
      logger.warn('═══════════════════════════════════════════════════════');
      return; // continue — don't throw in dev
    }
    handleQueueError(err, { dedup_key, jobId });
  }
}

// ---------------------------------------------------------------------------
// Welcome email — static jobId is fine (one welcome per user ever)
// ---------------------------------------------------------------------------

export async function queueWelcomeEmail(
  to: string,
  username: string,
  userId: string,
): Promise<void> {
  const dedup_key = `welcome-${userId}`;
  const jobId = safeJobId(dedup_key);
  const payload: WelcomeEmailJob = { name: 'send-welcome', to, username, dedup_key };

  try {
    await emailQueue.add('send-welcome', payload, { jobId });
    logger.info('Email job queued: send-welcome', { userId, dedup_key });
  } catch (err) {
    handleQueueError(err, { dedup_key });
  }
}

// ---------------------------------------------------------------------------
// Passcode changed notification
// ---------------------------------------------------------------------------

export async function queuePasscodeChangedEmail(
  to: string,
  username: string,
  userId: string,
  sessionId: string,
): Promise<void> {
  const dedup_key = `passcode-changed-${userId}-${sessionId}`;
  const jobId = safeJobId(dedup_key);
  const payload: PasscodeChangedEmailJob = {
    name: 'send-passcode-changed',
    to,
    username,
    dedup_key,
  };

  try {
    await emailQueue.add('send-passcode-changed', payload, { jobId });
    logger.info('Email job queued: send-passcode-changed', { userId, dedup_key });
  } catch (err) {
    handleQueueError(err, { dedup_key });
  }
}

// ---------------------------------------------------------------------------
// New device login alert
// ---------------------------------------------------------------------------

export async function queueNewDeviceLoginEmail(
  to: string,
  username: string,
  userId: string,
  deviceId: string,
  ipAddress: string,
): Promise<void> {
  const dedup_key = `new-device-${userId}-${deviceId}`;
  const jobId = safeJobId(dedup_key);
  const payload: NewDeviceLoginEmailJob = {
    name: 'send-new-device-login',
    to,
    username,
    device_id: deviceId,
    ip_address: ipAddress,
    dedup_key,
  };

  try {
    await emailQueue.add('send-new-device-login', payload, { jobId });
    logger.info('Email job queued: send-new-device-login', { userId, deviceId, dedup_key });
  } catch (err) {
    handleQueueError(err, { dedup_key });
  }
}

// ---------------------------------------------------------------------------
// KYC result notification
// ---------------------------------------------------------------------------

export async function queueKycResultEmail(
  to: string,
  username: string,
  attemptId: string,
  tier: number,
  passed: boolean,
  failureReason?: string,
): Promise<void> {
  const dedup_key = `kyc-result-${attemptId}`;
  const jobId = safeJobId(dedup_key);
  const payload: KycResultEmailJob = {
    name: 'send-kyc-result',
    to,
    username,
    tier,
    passed,
    failure_reason: failureReason,
    dedup_key,
  };

  try {
    await emailQueue.add('send-kyc-result', payload, { jobId });
    logger.info('Email job queued: send-kyc-result', { attemptId, passed, dedup_key });
  } catch (err) {
    handleQueueError(err, { dedup_key });
  }
}
