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

  try {
    await pushQueue.add('send-push', payload, { jobId: dedupKey });

    logger.info('Push job queued: send-push', { dedup_key: dedupKey });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    logger.error('Push queue enqueue failed', {
      dedup_key: dedupKey,
      error: message,
    });

    // Dev fallback — helps you test flows without FCM wired
    if (process.env.NODE_ENV !== 'production') {
      logger.warn('DEV PUSH fallback — notification not sent', {
        title,
        body,
        fcmToken: `${fcmToken.slice(0, 10)}...`,
      });
    }

    // ⚠️ Decide your policy:
    // - throw here (strict reliability)
    // - or swallow (high availability)
  }
}
