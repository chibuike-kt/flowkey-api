/**
 * FlowKey — Job Type Definitions
 *
 * Shared job payload types across all queues.
 * Every job has a deduplication key to prevent duplicate delivery.
 */

// ---------------------------------------------------------------------------
// Email jobs
// ---------------------------------------------------------------------------

export type EmailJobName =
  | 'send-otp'
  | 'send-welcome'
  | 'send-passcode-changed'
  | 'send-new-device-login'
  | 'send-kyc-result';

export interface OtpEmailJob {
  name: 'send-otp';
  to: string;
  otp: string;
  purpose:
    | 'Verify your email address'
    | 'Verify your phone'
    | 'Reset your passcode'
    | 'Reset your PIN';
  /** Deduplication key — prevents duplicate OTP emails within TTL window */
  dedup_key: string; // format: `otp:{userId}:{purpose}:{otp}`
}

export interface WelcomeEmailJob {
  name: 'send-welcome';
  to: string;
  username: string;
  dedup_key: string; // format: `welcome:{userId}`
}

export interface PasscodeChangedEmailJob {
  name: 'send-passcode-changed';
  to: string;
  username: string;
  dedup_key: string; // format: `passcode-changed:{userId}:{sessionId}`
}

export interface NewDeviceLoginEmailJob {
  name: 'send-new-device-login';
  to: string;
  username: string;
  device_id: string;
  ip_address: string;
  dedup_key: string; // format: `new-device:{userId}:{deviceId}`
}

export interface KycResultEmailJob {
  name: 'send-kyc-result';
  to: string;
  username: string;
  tier: number;
  passed: boolean;
  failure_reason?: string;
  dedup_key: string; // format: `kyc-result:{attemptId}`
}

export type EmailJobPayload =
  | OtpEmailJob
  | WelcomeEmailJob
  | PasscodeChangedEmailJob
  | NewDeviceLoginEmailJob
  | KycResultEmailJob;

// ---------------------------------------------------------------------------
// SMS jobs (stubbed — infrastructure ready)
// ---------------------------------------------------------------------------

export type SmsJobName = 'send-otp-sms' | 'send-generic-sms';

export interface OtpSmsJob {
  name: 'send-otp-sms';
  to: string;
  otp: string;
  dedup_key: string; // format: `sms-otp:{userId}:{otp}`
}

export interface GenericSmsJob {
  name: 'send-generic-sms';
  to: string;
  message: string;
  dedup_key: string;
}

export type SmsJobPayload = OtpSmsJob | GenericSmsJob;

// ---------------------------------------------------------------------------
// Push jobs (stubbed — infrastructure ready)
// ---------------------------------------------------------------------------

export type PushJobName = 'send-push';

export interface PushJob {
  name: 'send-push';
  fcm_token: string;
  title: string;
  body: string;
  data?: Record<string, string>;
  dedup_key: string;
}

export type PushJobPayload = PushJob;

// ---------------------------------------------------------------------------
// Bank transfer jobs (Phase 9)
// ---------------------------------------------------------------------------

export interface ProcessBankTransferJobData {
  transactionId: string;
  reference: string;
  senderWalletId: string;
  amountKobo: string; // BigInt serialised as string
  bankCode: string;
  accountNumber: string;
  accountName: string;
  narration: string | null;
  attemptNumber: number;
}

export interface AutoReverseBankTransferJobData {
  originalTransactionId: string;
  senderWalletId: string;
  amountKobo: string;
  reference: string;
  failureReason: string;
}
