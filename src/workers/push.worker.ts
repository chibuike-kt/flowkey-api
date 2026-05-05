/**
 * FlowKey — Push Worker (Stubbed — FCM-ready, Phase 14 full activation)
 *
 * To activate Firebase Cloud Messaging:
 *   1. npm install firebase-admin
 *   2. Set FIREBASE_SERVICE_ACCOUNT_PATH or FIREBASE_PROJECT_ID in env
 *   3. Uncomment the FCM block below
 */

import { Worker } from 'bullmq';
import { redis } from '../common/utils/redis';
import { logger } from '../common/utils/logger';
import type { PushJobPayload } from '../queues/jobs';

async function processPushJob(job: { data: PushJobPayload; id?: string }): Promise<void> {
  const payload = job.data;

  logger.info('Push worker: processing job', {
    job_id: job.id,
    job_name: payload.name,
    dedup_key: payload.dedup_key,
  });

  if (payload.name === 'send-push') {
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
  } else {
    throw new Error(`Unknown push job: ${JSON.stringify(payload)}`);
  }

  logger.info('Push worker: job completed', {
    job_id: job.id,
    dedup_key: payload.dedup_key,
  });
}

export function createPushWorker(): Worker<PushJobPayload> {
  const worker = new Worker<PushJobPayload>('push-queue', async (job) => processPushJob(job), {
    connection: redis,
    concurrency: 20,
  });

  worker.on('completed', (job) => {
    logger.info('Push worker: job succeeded', {
      job_id: job.id,
      attempts: job.attemptsMade,
    });
  });

  worker.on('failed', (job, err) => {
    logger.error('Push worker: job failed', {
      job_id: job?.id,
      error: err.message,
    });
  });

  worker.on('error', (err) => {
    logger.error('Push worker: worker-level error', {
      error: err.message,
    });
  });

  logger.info('Push worker started — listening on push-queue');

  return worker;
}
