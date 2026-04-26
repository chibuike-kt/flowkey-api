import Redis from 'ioredis';
import { logger } from './logger';

const redisUrl = process.env.REDIS_URL;

if (!redisUrl) {
  throw new Error('REDIS_URL is not set');
}

export const redis = new Redis(redisUrl, {
  retryStrategy(times) {
    const delay = Math.min(times * 500, 10000);
    logger.warn(`Redis reconnecting (attempt ${times})`, { delay });
    return delay;
  },
  keyPrefix: process.env.REDIS_KEY_PREFIX ?? 'fk:',
  enableReadyCheck: true,
  maxRetriesPerRequest: 3,
  lazyConnect: false,
});

redis.on('connect', () => logger.info('Redis connected'));
redis.on('ready', () => logger.info('Redis ready'));
redis.on('error', (err) => logger.error('Redis error', { error: err.message }));
redis.on('close', () => logger.warn('Redis connection closed'));
