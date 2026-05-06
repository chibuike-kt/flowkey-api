import { Worker } from 'bullmq';
import { createRedisConnection } from '../common/utils/redis';
import { logger } from '../common/utils/logger';
import type { PushJobPayload } from '../queues/jobs';

async function processPushJob(job: { data: PushJobPayload; id?: string }): Promise<void> {
  const payload = job.data;

  logger.info('Push worker: processing job', {
    job_id: job.id,
    job_name: payload.name,
    dedup_key: payload.dedup_key,
  });

  switch (payload.name) {
    case 'send-push': {
      logger.info('[PUSH STUB] Push notification would be sent', {
        fcm_token: `${payload.fcm_token.slice(0, 10)}...`,
        title: payload.title,
        body: payload.body,
        data: payload.data,
      });

      // PRODUCTION (Firebase Admin SDK):
      // import { getMessaging } from 'firebase-admin/messaging';
      // await getMessaging().send({
      //   token: payload.fcm_token,
      //   notification: { title: payload.title, body: payload.body },
      //   data: payload.data,
      // });
      break;
    }

    default:
      throw new Error(`Unknown push job: ${(payload as { name: string }).name}`);
  }

  logger.info('Push worker: job completed', { job_id: job.id, dedup_key: payload.dedup_key });
}

export function createPushWorker(): Worker<PushJobPayload> {
  const worker = new Worker<PushJobPayload>('push-queue', async (job) => processPushJob(job), {
    connection: createRedisConnection(),
    prefix: process.env['REDIS_KEY_PREFIX'] ?? 'fk',
    concurrency: 20,
  });

  worker.on('completed', (job) => {
    logger.info('Push worker: job succeeded', { job_id: job.id, attempts: job.attemptsMade });
  });

  worker.on('failed', (job, err) => {
    logger.error('Push worker: job failed', { job_id: job?.id, error: err.message });
  });

  worker.on('error', (err) => {
    logger.error('Push worker: worker-level error', { error: err.message });
  });

  logger.info('Push worker started — listening on push-queue');
  return worker;
}
