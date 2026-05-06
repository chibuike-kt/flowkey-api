import { Queue } from 'bullmq';
import { createRedisConnection } from '../common/utils/redis';
import type { EmailJobPayload, SmsJobPayload, PushJobPayload } from './jobs';

const prefix = process.env['REDIS_KEY_PREFIX'] ?? 'fk';

export const emailQueue = new Queue<EmailJobPayload>('email-queue', {
  connection: createRedisConnection(),
  prefix,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: { count: 500 },
    removeOnFail: { count: 1000 },
  },
});

export const smsQueue = new Queue<SmsJobPayload>('sms-queue', {
  connection: createRedisConnection(),
  prefix,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: { count: 200 },
    removeOnFail: { count: 500 },
  },
});

export const pushQueue = new Queue<PushJobPayload>('push-queue', {
  connection: createRedisConnection(),
  prefix,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: { count: 200 },
    removeOnFail: { count: 500 },
  },
});
