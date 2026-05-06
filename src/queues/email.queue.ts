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
// OTP email — timestamp in jobId prevents legitimate duplicate suppression
// ---------------------------------------------------------------------------

export async function queueOtpEmail(
  to: string,
  otp: string,
  purpose: OtpEmailJob['purpose'],
  userId: string,
): Promise<void> {
  const dedup_key = `otp:${userId}:${purpose}:${otp}`;
  const jobId = `${dedup_key}:${Date.now()}`;
  const payload: OtpEmailJob = { name: 'send-otp', to, otp, purpose, dedup_key };

  try {
    await emailQueue.add('send-otp', payload, { jobId });
    logger.info('Email job queued: send-otp', { userId, purpose, dedup_key, jobId });
  } catch (err) {
    if (!isProduction) {
      logger.warn('DEV OTP fallback — email queue failed', { to, otp, purpose, dedup_key });
    }
    handleQueueError(err, { dedup_key, jobId });
  }
}

// ---------------------------------------------------------------------------
// Welcome email — static jobId is fine (one welcome per user)
// ---------------------------------------------------------------------------

export async function queueWelcomeEmail(
  to: string,
  username: string,
  userId: string,
): Promise<void> {
  const dedup_key = `welcome:${userId}`;
  const payload: WelcomeEmailJob = { name: 'send-welcome', to, username, dedup_key };

  try {
    await emailQueue.add('send-welcome', payload, { jobId: dedup_key });
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
  const dedup_key = `passcode-changed:${userId}:${sessionId}`;
  const payload: PasscodeChangedEmailJob = {
    name: 'send-passcode-changed',
    to,
    username,
    dedup_key,
  };

  try {
    await emailQueue.add('send-passcode-changed', payload, { jobId: dedup_key });
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
  const dedup_key = `new-device:${userId}:${deviceId}`;
  const payload: NewDeviceLoginEmailJob = {
    name: 'send-new-device-login',
    to,
    username,
    device_id: deviceId,
    ip_address: ipAddress,
    dedup_key,
  };

  try {
    await emailQueue.add('send-new-device-login', payload, { jobId: dedup_key });
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
  const dedup_key = `kyc-result:${attemptId}`;
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
    await emailQueue.add('send-kyc-result', payload, { jobId: dedup_key });
    logger.info('Email job queued: send-kyc-result', { attemptId, passed, dedup_key });
  } catch (err) {
    handleQueueError(err, { dedup_key });
  }
}
