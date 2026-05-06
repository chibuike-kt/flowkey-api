import { smsQueue } from './index';
import { logger } from '../common/utils/logger';
import type { OtpSmsJob, GenericSmsJob } from './jobs';

export async function queueOtpSms(to: string, otp: string, userId: string): Promise<void> {
  const dedup_key = `sms-otp:${userId}:${otp}`;
  const payload: OtpSmsJob = { name: 'send-otp-sms', to, otp, dedup_key };

  try {
    await smsQueue.add('send-otp-sms', payload, { jobId: dedup_key });

    logger.info('SMS job queued: send-otp-sms', { userId, dedup_key });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    logger.error('SMS queue enqueue failed', {
      userId,
      dedup_key,
      error: message,
    });

    // DEV fallback (so testing doesn't block)
    if (process.env.NODE_ENV !== 'production') {
      logger.warn('DEV SMS fallback — OTP visible in logs', { to, otp });
    }

    // In production, you may want to throw instead depending on your policy
  }
}
