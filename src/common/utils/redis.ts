import Redis from 'ioredis';
import { logger } from './logger';

const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6380';

const redisClient = new Redis(redisUrl, {
  // Reconnect strategy — exponential backoff capped at 10 seconds
  retryStrategy(times: number): number {
    const delay = Math.min(times * 500, 10000);
    logger.warn(`Redis reconnecting (attempt ${times})`, { delay });
    return delay;
  },
  enableReadyCheck: true,
  maxRetriesPerRequest: 3,
  lazyConnect: false,
});

redisClient.on('connect', () => {
  logger.info('Redis connected');
});
redisClient.on('ready', () => {
  logger.info('Redis ready');
});
redisClient.on('error', (err: Error) => {
  logger.error('Redis error', { error: err.message });
});
redisClient.on('close', () => {
  logger.warn('Redis connection closed');
});

export const redis = redisClient;

/**
 * Factory for BullMQ connections.
 * BullMQ requires its own ioredis connection (it manages connection lifecycle internally).
 * Use this factory wherever BullMQ needs a connection — do NOT pass the singleton.
 */
export function createRedisConnection(): Redis {
  return new Redis(redisUrl, {
    maxRetriesPerRequest: null, // required by BullMQ
    enableReadyCheck: false, // required by BullMQ
  });
}
