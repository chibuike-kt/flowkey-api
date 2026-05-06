import { smsQueue } from './index';
import { logger } from '../common/utils/logger';
import { AppError, ErrorCode } from '../common/errors/AppError';
import type { OtpSmsJob, GenericSmsJob } from './jobs';

const isProduction = process.env['NODE_ENV'] === 'production';

function handleQueueError(err: unknown, context: Record<string, unknown>): void {
  const message = err instanceof Error ? err.message : String(err);
  logger.error('SMS queue: failed to enqueue job', { ...context, error: message });

  if (isProduction) {
    throw new AppError(
      ErrorCode.EXTERNAL_SERVICE_ERROR,
      'Notification service temporarily unavailable. Please try again.',
    );
  }

  logger.warn('DEV: SMS queue error — continuing without delivery', context);
}

// OTP SMS — timestamp jobId to avoid suppressing legitimate duplicate sends
export async function queueOtpSms(to: string, otp: string, userId: string): Promise<void> {
  const dedup_key = `sms-otp:${userId}:${otp}`;
  const jobId = `${dedup_key}:${Date.now()}`;
  const payload: OtpSmsJob = { name: 'send-otp-sms', to, otp, dedup_key };

  try {
    await smsQueue.add('send-otp-sms', payload, { jobId });
    logger.info('SMS job queued: send-otp-sms', { userId, dedup_key, jobId });
  } catch (err) {
    if (!isProduction) {
      logger.warn('DEV OTP SMS fallback — SMS queue failed', { to, otp, dedup_key });
    }
    handleQueueError(err, { dedup_key, jobId });
  }
}

export async function queueGenericSms(
  to: string,
  message: string,
  dedupKey: string,
): Promise<void> {
  const payload: GenericSmsJob = { name: 'send-generic-sms', to, message, dedup_key: dedupKey };

  try {
    await smsQueue.add('send-generic-sms', payload, { jobId: dedupKey });
    logger.info('SMS job queued: send-generic-sms', { dedup_key: dedupKey });
  } catch (err) {
    handleQueueError(err, { dedup_key: dedupKey });
  }
}
