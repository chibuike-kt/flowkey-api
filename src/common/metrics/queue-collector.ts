import { Queue } from 'bullmq';
import { bullmqQueueDepth } from './index';
import { logger } from '../utils/logger';

const POLL_INTERVAL_MS = 15_000;

const QUEUE_NAMES = [
  'flowkey-email',
  'flowkey-sms',
  'flowkey-push',
  'flowkey-bank-transfer',
  'flowkey-bank-reversal',
  'flowkey-card-deposit',
];

let _interval: NodeJS.Timeout | null = null;

export function startQueueCollector(redisUrl: string): void {
  if (_interval) return; // already running

  const connection = { url: redisUrl };

  const queues = QUEUE_NAMES.map((name) => ({
    name,
    queue: new Queue(name, { connection }),
  }));

  async function collect(): Promise<void> {
    for (const { name, queue } of queues) {
      try {
        const [waiting, delayed] = await Promise.all([
          queue.getWaitingCount(),
          queue.getDelayedCount(),
        ]);
        bullmqQueueDepth.set({ queue_name: name }, waiting + delayed);
      } catch (err) {
        logger.warn(`Queue depth collection failed for ${name}`, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  // Collect immediately, then on interval
  void collect();
  _interval = setInterval(() => {
    void collect();
  }, POLL_INTERVAL_MS);

  logger.info('Queue depth collector started', {
    queues: QUEUE_NAMES,
    interval_ms: POLL_INTERVAL_MS,
  });
}

export function stopQueueCollector(): void {
  if (_interval) {
    clearInterval(_interval);
    _interval = null;
  }
}


