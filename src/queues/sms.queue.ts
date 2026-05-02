import { smsQueue } from './index';
import { logger } from '../common/utils/logger';
import type { OtpSmsJob, GenericSmsJob } from './jobs';

export async function queueOtpSms(to: string, otp: string, userId: string): Promise<void> {
  const dedup_key = `sms-otp:${userId}:${otp}`;
  const payload: OtpSmsJob = { name: 'send-otp-sms', to, otp, dedup_key };

  await smsQueue.add('send-otp-sms', payload, { jobId: dedup_key });
  logger.info('SMS job queued: send-otp-sms', { userId, dedup_key });
}

export async function queueGenericSms(
  to: string,
  message: string,
  dedupKey: string,
): Promise<void> {
  const payload: GenericSmsJob = { name: 'send-generic-sms', to, message, dedup_key: dedupKey };

  await smsQueue.add('send-generic-sms', payload, { jobId: dedupKey });
  logger.info('SMS job queued: send-generic-sms', { dedup_key: dedupKey });
}
