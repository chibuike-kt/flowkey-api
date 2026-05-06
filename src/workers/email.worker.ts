import { Worker } from 'bullmq';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { createRedisConnection } from '../common/utils/redis';
import { logger } from '../common/utils/logger';
import { config } from '../config';
import type { EmailJobPayload } from '../queues/jobs';

// ---------------------------------------------------------------------------
// Singleton transporter — initialised once per worker process
// ---------------------------------------------------------------------------

let _transporter: Transporter | null = null;

async function getTransporter(): Promise<Transporter> {
  if (_transporter) return _transporter;

  const cfg = config();
  _transporter = nodemailer.createTransport({
    host: cfg.smtpHost,
    port: cfg.smtpPort,
    secure: cfg.smtpSecure,
    auth: { user: cfg.smtpUser, pass: cfg.smtpPass },
  });

  // Verify connection on first use — throws if misconfigured
  await _transporter.verify();
  logger.info('Email worker: SMTP transporter verified and ready');
  return _transporter;
}

// ---------------------------------------------------------------------------
// Email HTML templates
// ---------------------------------------------------------------------------

function otpTemplate(otp: string, purpose: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f5f5f5;margin:0;padding:40px 20px">
  <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;padding:40px;box-shadow:0 2px 8px rgba(0,0,0,.08)">
    <div style="margin-bottom:32px"><span style="font-size:24px;font-weight:700;color:#0a0a0a">FlowKey</span></div>
    <h1 style="font-size:20px;font-weight:600;color:#0a0a0a;margin:0 0 12px">${purpose}</h1>
    <p style="font-size:15px;color:#555;margin:0 0 32px;line-height:1.5">Use the code below. It expires in 5 minutes.</p>
    <div style="background:#f5f5f5;border-radius:8px;padding:24px;text-align:center;margin-bottom:32px">
      <span style="font-size:36px;font-weight:700;letter-spacing:8px;color:#0a0a0a;font-family:monospace">${otp}</span>
    </div>
    <p style="font-size:13px;color:#999;margin:0;line-height:1.5">If you did not request this code, you can safely ignore this email. Do not share this code with anyone.</p>
  </div>
</body>
</html>`;
}

function welcomeTemplate(username: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f5f5f5;margin:0;padding:40px 20px">
  <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;padding:40px;box-shadow:0 2px 8px rgba(0,0,0,.08)">
    <div style="margin-bottom:32px"><span style="font-size:24px;font-weight:700;color:#0a0a0a">FlowKey</span></div>
    <h1 style="font-size:20px;font-weight:600;color:#0a0a0a;margin:0 0 12px">Welcome, ${username}</h1>
    <p style="font-size:15px;color:#555;margin:0;line-height:1.6">Your FlowKey account is now active. You can send and receive money instantly.</p>
  </div>
</body>
</html>`;
}

function passcodeChangedTemplate(username: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f5f5f5;margin:0;padding:40px 20px">
  <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;padding:40px;box-shadow:0 2px 8px rgba(0,0,0,.08)">
    <div style="margin-bottom:32px"><span style="font-size:24px;font-weight:700;color:#0a0a0a">FlowKey</span></div>
    <h1 style="font-size:20px;font-weight:600;color:#0a0a0a;margin:0 0 12px">Your passcode was changed</h1>
    <p style="font-size:15px;color:#555;margin:0 0 16px;line-height:1.6">Hi ${username}, your FlowKey login passcode was just changed. All other active sessions have been logged out for your security.</p>
    <p style="font-size:15px;color:#c0392b;font-weight:600;margin:0">If you did not make this change, contact support immediately.</p>
  </div>
</body>
</html>`;
}

function newDeviceLoginTemplate(username: string, deviceId: string, ipAddress: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f5f5f5;margin:0;padding:40px 20px">
  <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;padding:40px;box-shadow:0 2px 8px rgba(0,0,0,.08)">
    <div style="margin-bottom:32px"><span style="font-size:24px;font-weight:700;color:#0a0a0a">FlowKey</span></div>
    <h1 style="font-size:20px;font-weight:600;color:#0a0a0a;margin:0 0 12px">New device login detected</h1>
    <p style="font-size:15px;color:#555;margin:0 0 16px;line-height:1.6">Hi ${username}, your FlowKey account was accessed from a new device.</p>
    <table style="font-size:14px;color:#555;border-collapse:collapse;width:100%">
      <tr><td style="padding:6px 0;color:#999">Device ID</td><td style="padding:6px 0">${deviceId}</td></tr>
      <tr><td style="padding:6px 0;color:#999">IP Address</td><td style="padding:6px 0">${ipAddress}</td></tr>
    </table>
    <p style="font-size:15px;color:#c0392b;font-weight:600;margin:16px 0 0">If this was not you, secure your account immediately.</p>
  </div>
</body>
</html>`;
}

function kycResultTemplate(
  username: string,
  tier: number,
  passed: boolean,
  failureReason?: string,
): string {
  const statusColour = passed ? '#27ae60' : '#c0392b';
  const statusText = passed ? `Tier ${tier} Verified` : `Tier ${tier} Verification Failed`;
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f5f5f5;margin:0;padding:40px 20px">
  <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;padding:40px;box-shadow:0 2px 8px rgba(0,0,0,.08)">
    <div style="margin-bottom:32px"><span style="font-size:24px;font-weight:700;color:#0a0a0a">FlowKey</span></div>
    <h1 style="font-size:20px;font-weight:600;color:${statusColour};margin:0 0 12px">${statusText}</h1>
    <p style="font-size:15px;color:#555;margin:0 0 16px;line-height:1.6">Hi ${username}, your KYC verification for Tier ${tier} has been ${passed ? 'approved. Your transfer limits have been upgraded.' : `declined.${failureReason ? ` Reason: ${failureReason}` : ''} You can retry after the cooldown period.`}</p>
  </div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Job processor
// ---------------------------------------------------------------------------

async function processEmailJob(job: { data: EmailJobPayload; id?: string }): Promise<void> {
  const cfg = config();
  const transporter = await getTransporter();
  const payload = job.data;

  logger.info('Email worker: processing job', {
    job_id: job.id,
    job_name: payload.name,
    dedup_key: payload.dedup_key,
  });

  switch (payload.name) {
    case 'send-otp':
      await transporter.sendMail({
        from: cfg.smtpFrom,
        to: payload.to,
        subject: `${payload.otp} — Your FlowKey verification code`,
        html: otpTemplate(payload.otp, payload.purpose),
      });
      break;

    case 'send-welcome':
      await transporter.sendMail({
        from: cfg.smtpFrom,
        to: payload.to,
        subject: 'Welcome to FlowKey',
        html: welcomeTemplate(payload.username),
      });
      break;

    case 'send-passcode-changed':
      await transporter.sendMail({
        from: cfg.smtpFrom,
        to: payload.to,
        subject: 'FlowKey — Your passcode was changed',
        html: passcodeChangedTemplate(payload.username),
      });
      break;

    case 'send-new-device-login':
      await transporter.sendMail({
        from: cfg.smtpFrom,
        to: payload.to,
        subject: 'FlowKey — New device login detected',
        html: newDeviceLoginTemplate(payload.username, payload.device_id, payload.ip_address),
      });
      break;

    case 'send-kyc-result':
      await transporter.sendMail({
        from: cfg.smtpFrom,
        to: payload.to,
        subject: `FlowKey — KYC Tier ${payload.tier} ${payload.passed ? 'Approved' : 'Declined'}`,
        html: kycResultTemplate(
          payload.username,
          payload.tier,
          payload.passed,
          payload.failure_reason,
        ),
      });
      break;

    default: {
      const _exhaustive: never = payload;
      throw new Error(`Unknown email job: ${JSON.stringify(_exhaustive)}`);
    }
  }

  logger.info('Email worker: job completed', {
    job_id: job.id,
    job_name: payload.name,
    to: payload.to,
    dedup_key: payload.dedup_key,
  });
}

// ---------------------------------------------------------------------------
// Worker factory — called by workers/index.ts
// ---------------------------------------------------------------------------

export function createEmailWorker(): Worker<EmailJobPayload> {
  const worker = new Worker<EmailJobPayload>('email-queue', async (job) => processEmailJob(job), {
    connection: createRedisConnection(),
    prefix: process.env['REDIS_KEY_PREFIX'] ?? 'fk',
    concurrency: 5, // process up to 5 emails concurrently
    limiter: {
      max: 30, // max 30 jobs per duration window
      duration: 1000, // per 1 second — prevents SMTP rate limits
    },
  });

  worker.on('completed', (job) => {
    logger.info('Email worker: job succeeded', {
      job_id: job.id,
      job_name: job.data.name,
      attempts: job.attemptsMade,
    });
  });

  worker.on('failed', (job, err) => {
    logger.error('Email worker: job failed', {
      job_id: job?.id,
      job_name: job?.data?.name,
      attempts: job?.attemptsMade,
      error: err.message,
    });
    // Never rethrow — worker stays alive
  });

  worker.on('error', (err) => {
    logger.error('Email worker: worker-level error', { error: err.message });
  });

  logger.info('Email worker started — listening on email-queue');
  return worker;
}
