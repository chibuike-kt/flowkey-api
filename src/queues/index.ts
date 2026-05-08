import { Queue } from 'bullmq';
import { createRedisConnection } from '../common/utils/redis';

const queueOptions = {
  connection: createRedisConnection(),
  prefix: process.env['REDIS_KEY_PREFIX'] ?? 'fk',
};

export const emailQueue = new Queue('email', queueOptions);
export const smsQueue = new Queue('sms', queueOptions);
export const pushQueue = new Queue('push', queueOptions);
export const bankTransferQueue = new Queue('bank-transfer', queueOptions);
export const bankReversalQueue = new Queue('bank-reversal', queueOptions);
