import * as nodemailer from 'nodemailer';
import { config } from '../../config';
import { logger } from '../../common/utils/logger';

// Result type — callers use this to apply environment-aware delivery logic.
// The notification service NEVER throws — it always returns a result.
// Environment-aware behaviour (fail in prod, warn in dev) lives in the
// service layer that calls these functions, not here.

export type NotificationResult = {
  success: boolean;
  error?: string;
};

// Email transport (Nodemailer)

let _transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter {
  if (_transporter) return _transporter;

  const cfg = config();

  _transporter = nodemailer.createTransport({
    host: cfg.smtpHost,
    port: cfg.smtpPort,
    secure: cfg.smtpSecure,
    auth: {
      user: cfg.smtpUser,
      pass: cfg.smtpPass,
    },
  });

  return _transporter;
}

// Email templates

function otpEmailHtml(otp: string, purpose: string): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>FlowKey Verification Code</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
             background: #f5f5f5; margin: 0; padding: 40px 20px;">
  <div style="max-width: 480px; margin: 0 auto; background: #ffffff;
              border-radius: 12px; padding: 40px; box-shadow: 0 2px 8px rgba(0,0,0,0.08);">
    <div style="margin-bottom: 32px;">
      <span style="font-size: 24px; font-weight: 700; color: #0a0a0a;">FlowKey</span>
    </div>
    <h1 style="font-size: 20px; font-weight: 600; color: #0a0a0a; margin: 0 0 12px;">
      ${purpose}
    </h1>
    <p style="font-size: 15px; color: #555; margin: 0 0 32px; line-height: 1.5;">
      Use the code below. It expires in 5 minutes.
    </p>
    <div style="background: #f5f5f5; border-radius: 8px; padding: 24px;
                text-align: center; margin-bottom: 32px;">
      <span style="font-size: 36px; font-weight: 700; letter-spacing: 8px;
                   color: #0a0a0a; font-family: monospace;">${otp}</span>
    </div>
    <p style="font-size: 13px; color: #999; margin: 0; line-height: 1.5;">
      If you did not request this code, you can safely ignore this email.
      Do not share this code with anyone.
    </p>
  </div>
</body>
</html>
  `.trim();
}

// Public email senders

export async function sendOtpEmail(
  to: string,
  otp: string,
  purpose: 'Verify your email address' | 'Verify your phone' | 'Reset your passcode',
): Promise<NotificationResult> {
  const cfg = config();

  try {
    const transporter = getTransporter();
    await transporter.sendMail({
      from: cfg.smtpFrom,
      to,
      subject: `${otp} — Your FlowKey verification code`,
      html: otpEmailHtml(otp, purpose),
    });
    logger.info('OTP email sent', { to, purpose });
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('OTP email delivery failed', { to, purpose, error: message });
    return { success: false, error: message };
  }
}

export async function sendWelcomeEmail(to: string, displayName: string): Promise<void> {
  const cfg = config();

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
             background: #f5f5f5; margin: 0; padding: 40px 20px;">
  <div style="max-width: 480px; margin: 0 auto; background: #fff;
              border-radius: 12px; padding: 40px; box-shadow: 0 2px 8px rgba(0,0,0,0.08);">
    <div style="margin-bottom: 32px;">
      <span style="font-size: 24px; font-weight: 700; color: #0a0a0a;">FlowKey</span>
    </div>
    <h1 style="font-size: 20px; font-weight: 600; color: #0a0a0a; margin: 0 0 12px;">
      Welcome, ${displayName}
    </h1>
    <p style="font-size: 15px; color: #555; margin: 0; line-height: 1.6;">
      Your FlowKey account is now active. You can send and receive money instantly.
    </p>
  </div>
</body>
</html>
  `.trim();

  try {
    const transporter = getTransporter();
    await transporter.sendMail({
      from: cfg.smtpFrom,
      to,
      subject: 'Welcome to FlowKey',
      html,
    });
    logger.info('Welcome email sent', { to });
  } catch (err) {
    logger.error('Welcome email delivery failed', {
      to,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function sendPasscodeChangedEmail(to: string, displayName: string): Promise<void> {
  const cfg = config();
  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
             background: #f5f5f5; margin: 0; padding: 40px 20px;">
  <div style="max-width: 480px; margin: 0 auto; background: #fff;
              border-radius: 12px; padding: 40px; box-shadow: 0 2px 8px rgba(0,0,0,0.08);">
    <div style="margin-bottom: 32px;">
      <span style="font-size: 24px; font-weight: 700; color: #0a0a0a;">FlowKey</span>
    </div>
    <h1 style="font-size: 20px; font-weight: 600; color: #0a0a0a; margin: 0 0 12px;">
      Your passcode was changed
    </h1>
    <p style="font-size: 15px; color: #555; margin: 0 0 16px; line-height: 1.6;">
      Hi ${displayName}, your FlowKey login passcode was just changed.
      All other active sessions have been logged out for your security.
    </p>
    <p style="font-size: 15px; color: #c0392b; font-weight: 600; margin: 0;">
      If you did not make this change, contact support immediately.
    </p>
  </div>
</body>
</html>
  `.trim();

  try {
    const transporter = getTransporter();
    await transporter.sendMail({
      from: cfg.smtpFrom,
      to,
      subject: 'FlowKey — Your passcode was changed',
      html,
    });
  } catch (err) {
    logger.error('Passcode change email delivery failed', {
      to,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// SMS — Twilio (STUBBED — infrastructure ready, not wired to live provider)
// To activate:
//   1. npm install twilio
//   2. Add TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER to .env
//   3. Uncomment the Twilio client block below
//   4. Replace the logger.info stubs with actual Twilio calls

export async function sendOtpSms(to: string, otp: string): Promise<NotificationResult> {
  // STUB — SMS not yet wired to a live provider.
  // Returns success:true so the auth flow proceeds (stub never fails).
  // When Twilio is wired in, failures will return { success: false }.
  logger.info('[SMS STUB] OTP SMS would be sent', {
    to,
    message: `Your FlowKey verification code is: ${otp}. Valid for 5 minutes. Do not share.`,
    provider: 'twilio',
    status: 'stubbed',
  });
  return { success: true };

  // PRODUCTION IMPLEMENTATION (Twilio):
  // ─────────────────────────────────────
  // import twilio from 'twilio';
  // const client = twilio(
  //   process.env['TWILIO_ACCOUNT_SID'],
  //   process.env['TWILIO_AUTH_TOKEN'],
  // );
  // try {
  //   await client.messages.create({
  //     body: `Your FlowKey verification code is: ${otp}. Valid for 5 minutes. Do not share.`,
  //     from: process.env['TWILIO_FROM_NUMBER'],
  //     to,
  //   });
  //   return { success: true };
  // } catch (err) {
  //   const message = err instanceof Error ? err.message : String(err);
  //   logger.error('OTP SMS delivery failed', { to, error: message });
  //   return { success: false, error: message };
  // }
}

export async function sendGenericSms(to: string, message: string): Promise<void> {
  // STUB
  logger.info('[SMS STUB] SMS would be sent', {
    to,
    message,
    provider: 'twilio',
    status: 'stubbed',
  });

  // PRODUCTION IMPLEMENTATION (Twilio):
  // import twilio from 'twilio';
  // const client = twilio(cfg.twilioAccountSid, cfg.twilioAuthToken);
  // await client.messages.create({ body: message, from: cfg.twilioFromNumber, to });
}

// Push (Firebase Cloud Messaging) — Phase 14 full wiring

export async function sendPushNotification(
  fcmToken: string,
  title: string,
  body: string,
  data?: Record<string, string>,
): Promise<void> {
  // STUB — FCM full wiring in Phase 14
  logger.info('[PUSH STUB] Push notification would be sent', {
    fcmToken: fcmToken.slice(0, 10) + '...',
    title,
    body,
    data,
    provider: 'fcm',
    status: 'stubbed',
  });

  // PRODUCTION IMPLEMENTATION (Firebase Admin):
  // import { getMessaging } from 'firebase-admin/messaging';
  // await getMessaging().send({
  //   token: fcmToken,
  //   notification: { title, body },
  //   data,
  // });
}
