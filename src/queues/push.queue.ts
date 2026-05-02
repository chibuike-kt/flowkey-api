import { pushQueue } from './index';
import { logger } from '../common/utils/logger';
import type { PushJob } from './jobs';

export async function queuePushNotification(
  fcmToken: string,
  title: string,
  body: string,
  dedupKey: string,
  data?: Record<string, string>,
): Promise<void> {
  const payload: PushJob = {
    name: 'send-push',
    fcm_token: fcmToken,
    title,
    body,
    data,
    dedup_key: dedupKey,
  };

  await pushQueue.add('send-push', payload, { jobId: dedupKey });
  logger.info('Push job queued: send-push', { dedup_key: dedupKey });
}
