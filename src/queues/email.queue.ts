/**
 * FlowKey — Email Queue Helpers
 *
 * All callers use these functions — never import emailQueue directly.
 * Each helper enforces deduplication, retries, and logging.
 */

import { emailQueue } from './index';
import { logger } from '../common/utils/logger';
import type {
  OtpEmailJob,
  WelcomeEmailJob,
  PasscodeChangedEmailJob,
  NewDeviceLoginEmailJob,
  KycResultEmailJob,
} from './jobs';

// ---------------------------------------------------------------------------
// Shared job options (important for reliability)
// ---------------------------------------------------------------------------

const defaultJobOptions = {
  removeOnComplete: true,
  removeOnFail: false, // keep failed jobs for debugging
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 2000,
  },
};

// ---------------------------------------------------------------------------
// OTP email
// ---------------------------------------------------------------------------

export async function queueOtpEmail(
  to: string,
  otp: string,
  purpose: OtpEmailJob['purpose'],
  userId: string,
): Promise<void> {
  const dedup_key = `otp:${userId}:${purpose}`;

  const payload: OtpEmailJob = {
    name: 'send-otp',
    to,
    otp,
    purpose,
    dedup_key,
  };

  await emailQueue.add('send-otp', payload, {
    jobId: dedup_key,
    ...defaultJobOptions,
  });

  logger.info('Email job queued: send-otp', { userId, purpose, dedup_key });
}

// ---------------------------------------------------------------------------
// Welcome email
// ---------------------------------------------------------------------------

export async function queueWelcomeEmail(
  to: string,
  username: string,
  userId: string,
): Promise<void> {
  const dedup_key = `welcome:${userId}`;

  const payload: WelcomeEmailJob = {
    name: 'send-welcome',
    to,
    username,
    dedup_key,
  };

  await emailQueue.add('send-welcome', payload, {
    jobId: dedup_key,
    ...defaultJobOptions,
  });

  logger.info('Email job queued: send-welcome', { userId, dedup_key });
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

  await emailQueue.add('send-passcode-changed', payload, {
    jobId: dedup_key,
    ...defaultJobOptions,
  });

  logger.info('Email job queued: send-passcode-changed', { userId, dedup_key });
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

  await emailQueue.add('send-new-device-login', payload, {
    jobId: dedup_key,
    ...defaultJobOptions,
  });

  logger.info('Email job queued: send-new-device-login', {
    userId,
    deviceId,
    dedup_key,
  });
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

  await emailQueue.add('send-kyc-result', payload, {
    jobId: dedup_key,
    ...defaultJobOptions,
  });

  logger.info('Email job queued: send-kyc-result', {
    attemptId,
    passed,
    dedup_key,
  });
}
