import { pushQueue } from './index';
import { logger } from '../common/utils/logger';
import { AppError, ErrorCode } from '../common/errors/AppError';
import type { PushJob } from './jobs';

const isProduction = process.env['NODE_ENV'] === 'production';

function handleQueueError(err: unknown, context: Record<string, unknown>): void {
  const message = err instanceof Error ? err.message : String(err);
  logger.error('Push queue: failed to enqueue job', { ...context, error: message });

  if (isProduction) {
    throw new AppError(
      ErrorCode.EXTERNAL_SERVICE_ERROR,
      'Notification service temporarily unavailable. Please try again.',
    );
  }

  logger.warn('DEV: push queue error — continuing without delivery', context);
}

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
    handleQueueError(err, { dedup_key: dedupKey });
  }
}
