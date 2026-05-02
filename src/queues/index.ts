import { Queue } from 'bullmq';
import { redis } from '../common/utils/redis';
import type { EmailJobPayload, SmsJobPayload, PushJobPayload } from './jobs';

// Shared BullMQ connection config — reuses the existing ioredis instance
const connection = redis;

// ---------------------------------------------------------------------------
// Queue instances
// ---------------------------------------------------------------------------

export const emailQueue = new Queue<EmailJobPayload>('email-queue', {
  connection,
  defaultJobOptions: {
    attempts: 5,
    backoff: {
      type: 'exponential',
      delay: 2000, // 2s, 4s, 8s, 16s, 32s
    },
    removeOnComplete: { count: 500 }, // keep last 500 completed jobs for inspection
    removeOnFail: { count: 1000 }, // keep last 1000 failed jobs for audit
  },
});

export const smsQueue = new Queue<SmsJobPayload>('sms-queue', {
  connection,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: { count: 200 },
    removeOnFail: { count: 500 },
  },
});

export const pushQueue = new Queue<PushJobPayload>('push-queue', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: { count: 200 },
    removeOnFail: { count: 500 },
  },
});
