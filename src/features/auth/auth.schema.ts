/**
 * FlowKey — Auth Feature Zod Schemas
 *
 * All input validation for auth endpoints.
 * Schema is defined BEFORE handler logic — always.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Reusable field schemas
// ---------------------------------------------------------------------------

const phoneSchema = z
  .string()
  .regex(
    /^\+234[0-9]{10}$/,
    'Phone number must be a valid Nigerian number in E.164 format (+234XXXXXXXXXX)',
  );

const loginPasscodeSchema = z.string().regex(/^\d{6}$/, 'Login passcode must be exactly 6 digits');

const transactionPinSchema = z
  .string()
  .regex(/^\d{4}$/, 'Transaction PIN must be exactly 4 digits');

const otpSchema = z.string().regex(/^\d{6}$/, 'OTP must be exactly 6 digits');

const uuidSchema = z.string().uuid('Must be a valid UUID v4');

const deviceIdSchema = z.string().min(1, 'Device ID is required').max(255, 'Device ID too long');

const fcmTokenSchema = z.string().min(1, 'FCM token is required').max(512, 'FCM token too long');

// ---------------------------------------------------------------------------
// Endpoint schemas
// ---------------------------------------------------------------------------

export const RegisterSchema = z.object({
  phone: phoneSchema,
  email: z.string().email('Must be a valid email address'),
  display_name: z.string().min(2, 'Display name too short').max(100, 'Display name too long'),
  login_passcode: loginPasscodeSchema,
  device_id: deviceIdSchema,
  fcm_token: fcmTokenSchema,
});

export const VerifyOtpSchema = z.object({
  user_id: uuidSchema,
  otp: otpSchema,
});

export const ResendOtpSchema = z.object({
  user_id: uuidSchema,
});

export const LoginSchema = z.object({
  phone: phoneSchema,
  login_passcode: loginPasscodeSchema,
  device_id: deviceIdSchema,
  fcm_token: fcmTokenSchema,
});

export const RefreshTokenSchema = z.object({
  refresh_token: z.string().min(1, 'Refresh token is required'),
  device_id: deviceIdSchema,
});

export const LogoutSchema = z.object({
  refresh_token: z.string().min(1, 'Refresh token is required'),
});

export const ChangePasscodeSchema = z
  .object({
    current_passcode: loginPasscodeSchema,
    new_passcode: loginPasscodeSchema,
  })
  .refine((data) => data.current_passcode !== data.new_passcode, {
    message: 'New passcode must be different from current passcode',
    path: ['new_passcode'],
  });

export const ForgotPasscodeSchema = z.object({
  phone: phoneSchema,
});

export const ResetPasscodeSchema = z.object({
  reset_token: z.string().min(1, 'Reset token is required'),
  phone_otp: otpSchema,
  email_otp: otpSchema,
  new_passcode: loginPasscodeSchema,
});

export const SetTransactionPinSchema = z.object({
  login_passcode: loginPasscodeSchema,
  transaction_pin: transactionPinSchema,
});

export const ChangeTransactionPinSchema = z
  .object({
    current_pin: transactionPinSchema,
    new_pin: transactionPinSchema,
  })
  .refine((data) => data.current_pin !== data.new_pin, {
    message: 'New PIN must be different from current PIN',
    path: ['new_pin'],
  });

export const DeleteTransactionPinSchema = z.object({
  login_passcode: loginPasscodeSchema,
});

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------

export type RegisterInput = z.infer<typeof RegisterSchema>;
export type VerifyOtpInput = z.infer<typeof VerifyOtpSchema>;
export type ResendOtpInput = z.infer<typeof ResendOtpSchema>;
export type LoginInput = z.infer<typeof LoginSchema>;
export type RefreshTokenInput = z.infer<typeof RefreshTokenSchema>;
export type LogoutInput = z.infer<typeof LogoutSchema>;
export type ChangePasscodeInput = z.infer<typeof ChangePasscodeSchema>;
export type ForgotPasscodeInput = z.infer<typeof ForgotPasscodeSchema>;
export type ResetPasscodeInput = z.infer<typeof ResetPasscodeSchema>;
export type SetTransactionPinInput = z.infer<typeof SetTransactionPinSchema>;
export type ChangeTransactionPinInput = z.infer<typeof ChangeTransactionPinSchema>;
export type DeleteTransactionPinInput = z.infer<typeof DeleteTransactionPinSchema>;
