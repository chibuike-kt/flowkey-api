import * as nodemailer from 'nodemailer';
import { config } from '../../config';
import { logger } from '../../common/utils/logger';

export type NotificationResult = {
  success: boolean;
  error?: string;
};

let _transporter: nodemailer.Transporter | null = null;

function createTransporter(): nodemailer.Transporter {
  const cfg = config();

  return nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true, // REQUIRED for 465
    auth: {
      user: cfg.smtpUser,
      pass: cfg.smtpPass,
    },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 10000,
    tls: {
      rejectUnauthorized: false,
    },
  });
}

export function getTransporter(): nodemailer.Transporter {
  if (!_transporter) {
    _transporter = createTransporter();
  }
  return _transporter;
}

/**
 * OPTIONAL: call once at server startup (NOT inside request flow)
 */
export async function verifySmtpConnection(): Promise<void> {
  try {
    await getTransporter().verify();
    logger.info('SMTP connection verified');
  } catch (err) {
    logger.warn('SMTP verification failed (non-fatal)', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/* -------------------------------------------------------------------------- */
/*                               EMAIL TEMPLATES                              */
/* -------------------------------------------------------------------------- */

function otpEmailHtml(otp: string, purpose: string): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
</head>
<body style="font-family: Arial, sans-serif; background:#f5f5f5; padding:40px;">
  <div style="max-width:480px;margin:auto;background:#fff;padding:30px;border-radius:10px;">
    <h2 style="margin:0 0 10px;">FlowKey</h2>
    <h3>${purpose}</h3>
    <p>Your verification code:</p>

    <div style="font-size:32px;font-weight:bold;letter-spacing:6px;margin:20px 0;">
      ${otp}
    </div>

    <p style="color:#666;font-size:12px;">
      This code expires in 5 minutes. Do not share it.
    </p>
  </div>
</body>
</html>
  `.trim();
}

/* -------------------------------------------------------------------------- */
/*                               EMAIL SENDERS                                */
/* -------------------------------------------------------------------------- */

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
      subject: `FlowKey Verification Code`,
      html: otpEmailHtml(otp, purpose),
    });

    logger.info('OTP email sent', { to, purpose });

    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    logger.error('OTP email failed', {
      to,
      purpose,
      error: message,
    });

    return {
      success: false,
      error: message,
    };
  }
}

export async function sendWelcomeEmail(
  to: string,
  displayName: string,
): Promise<NotificationResult> {
  const cfg = config();

  const html = `
  <div>
    <h2>Welcome, ${displayName}</h2>
    <p>Your FlowKey account is ready.</p>
  </div>
  `.trim();

  try {
    await getTransporter().sendMail({
      from: cfg.smtpFrom,
      to,
      subject: 'Welcome to FlowKey',
      html,
    });

    logger.info('Welcome email sent', { to });

    return { success: true };
  } catch (err) {
    logger.error('Welcome email failed', {
      to,
      error: err instanceof Error ? err.message : String(err),
    });

    return { success: false };
  }
}

export async function sendPasscodeChangedEmail(
  to: string,
  displayName: string,
): Promise<NotificationResult> {
  const cfg = config();

  const html = `
  <div>
    <h2>Passcode Changed</h2>
    <p>Hi ${displayName}, your passcode was updated.</p>
  </div>
  `.trim();

  try {
    await getTransporter().sendMail({
      from: cfg.smtpFrom,
      to,
      subject: 'FlowKey Security Alert',
      html,
    });

    logger.info('Passcode change email sent', { to });

    return { success: true };
  } catch (err) {
    logger.error('Passcode change email failed', {
      to,
      error: err instanceof Error ? err.message : String(err),
    });

    return { success: false };
  }
}

/* -------------------------------------------------------------------------- */
/*                                   SMS                                      */
/* -------------------------------------------------------------------------- */

export async function sendOtpSms(to: string, otp: string): Promise<NotificationResult> {
  logger.info('[SMS STUB] OTP SMS', {
    to,
    otp,
  });

  return { success: true };
}

export async function sendGenericSms(to: string, message: string): Promise<NotificationResult> {
  logger.info('[SMS STUB]', { to, message });
  return { success: true };
}

/* -------------------------------------------------------------------------- */
/*                                   PUSH                                     */
/* -------------------------------------------------------------------------- */

export async function sendPushNotification(
  fcmToken: string,
  title: string,
  body: string,
  data?: Record<string, string>,
): Promise<NotificationResult> {
  logger.info('[PUSH STUB]', {
    token: fcmToken.slice(0, 10),
    title,
    body,
    data,
  });

  return { success: true };
}
