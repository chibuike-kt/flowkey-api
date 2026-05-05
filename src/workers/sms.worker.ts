/**
 * FlowKey — SMS Worker (Stubbed — Twilio-ready)
 *
 * To activate Twilio:
 *   1. npm install twilio
 *   2. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER in env
 *   3. Uncomment the Twilio block below
 */
import { Worker } from 'bullmq';
import { redis } from '../common/utils/redis';
import { logger } from '../common/utils/logger';
import type { SmsJobPayload } from '../queues/jobs';

async function processSmsJob(job: { data: SmsJobPayload; id?: string }): Promise<void> {
  const payload = job.data;

  logger.info('SMS worker: processing job', {
    job_id: job.id,
    job_name: payload.name,
    dedup_key: payload.dedup_key,
  });

  switch (payload.name) {
    case 'send-otp-sms': {
      // STUB — log only
      logger.info('[SMS STUB] OTP SMS would be sent', {
        to: payload.to,
        message: `Your FlowKey verification code is: ${payload.otp}. Valid for 5 minutes. Do not share.`,
      });

      // PRODUCTION (Twilio):
      // const client = twilio(process.env['TWILIO_ACCOUNT_SID'], process.env['TWILIO_AUTH_TOKEN']);
      // await client.messages.create({
      //   body: `Your FlowKey verification code is: ${payload.otp}. Valid for 5 minutes. Do not share.`,
      //   from: process.env['TWILIO_FROM_NUMBER'],
      //   to: payload.to,
      // });
      break;
    }

    case 'send-generic-sms': {
      logger.info('[SMS STUB] Generic SMS would be sent', {
        to: payload.to,
        message: payload.message,
      });

      // PRODUCTION (Twilio):
      // const client = twilio(process.env['TWILIO_ACCOUNT_SID'], process.env['TWILIO_AUTH_TOKEN']);
      // await client.messages.create({ body: payload.message, from: process.env['TWILIO_FROM_NUMBER'], to: payload.to });
      break;
    }

    default: {
      const _exhaustive: never = payload;
      throw new Error(`Unknown SMS job: ${JSON.stringify(_exhaustive)}`);
    }
  }

  logger.info('SMS worker: job completed', {
    job_id: job.id,
    job_name: payload.name,
    dedup_key: payload.dedup_key,
  });
}

export function createSmsWorker(): Worker<SmsJobPayload> {
  const worker = new Worker<SmsJobPayload>('sms-queue', async (job) => processSmsJob(job), {
    connection: redis,
    concurrency: 10,
  });

  worker.on('completed', (job) => {
    logger.info('SMS worker: job succeeded', {
      job_id: job.id,
      job_name: job.data.name,
      attempts: job.attemptsMade,
    });
  });

  worker.on('failed', (job, err) => {
    logger.error('SMS worker: job failed', {
      job_id: job?.id,
      job_name: job?.data?.name,
      error: err.message,
    });
  });

  worker.on('error', (err) => {
    logger.error('SMS worker: worker-level error', { error: err.message });
  });

  logger.info('SMS worker started — listening on sms-queue');
  return worker;
}
