import { z } from 'zod';

const phoneRegex = /^\+234[0-9]{10}$/;
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const passcodeRegex = /^\d{6}$/;
const pinRegex = /^\d{4}$/;
const uppRegex = /^\d{6}$/;
const otpRegex = /^\d{6}$/;
const usernameRegex = /^[a-zA-Z0-9_]{5,30}$/;

// Accepts phone or email — validated by type
export const InitiateRegistrationSchema = z
  .object({
    contact: z.string().min(1, 'Phone number or email is required'),
    contact_type: z.enum(['phone', 'email']),
  })
  .superRefine((data, ctx) => {
    if (data.contact_type === 'phone' && !phoneRegex.test(data.contact)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['contact'],
        message: 'Phone must be a valid Nigerian number in E.164 format (+234XXXXXXXXXX)',
      });
    }
    if (data.contact_type === 'email' && !emailRegex.test(data.contact)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['contact'],
        message: 'Must be a valid email address',
      });
    }
  });

export const VerifyOtpSchema = z.object({
  registration_id: z.string().uuid('Must be a valid UUID'),
  otp: z.string().regex(otpRegex, 'OTP must be exactly 6 digits'),
});

export const CheckUsernameSchema = z.object({
  username: z
    .string()
    .regex(
      usernameRegex,
      'Username must be 5–30 characters, letters, numbers, and underscores only',
    ),
});

export const CompleteRegistrationSchema = z.object({
  registration_id: z.string().uuid('Must be a valid UUID'),
  username: z
    .string()
    .regex(
      usernameRegex,
      'Username must be 5–30 characters, letters, numbers, and underscores only',
    ),
  login_passcode: z.string().regex(passcodeRegex, 'Passcode must be exactly 6 digits'),
  device_id: z.string().min(1).max(255),
  fcm_token: z.string().min(1).max(512),
});

export const ResendOtpSchema = z.object({
  registration_id: z.string().uuid('Must be a valid UUID'),
});

export const LoginSchema = z
  .object({
    contact: z.string().min(1, 'Phone number or email is required'),
    contact_type: z.enum(['phone', 'email']),
    login_passcode: z.string().regex(passcodeRegex, 'Passcode must be exactly 6 digits'),
    device_id: z.string().min(1).max(255),
    fcm_token: z.string().min(1).max(512),
  })
  .superRefine((data, ctx) => {
    if (data.contact_type === 'phone' && !phoneRegex.test(data.contact)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['contact'],
        message: 'Invalid Nigerian phone number (+234XXXXXXXXXX)',
      });
    }
    if (data.contact_type === 'email' && !emailRegex.test(data.contact)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['contact'],
        message: 'Invalid email address',
      });
    }
  });

export const RefreshTokenSchema = z.object({
  refresh_token: z.string().min(1),
  device_id: z.string().min(1).max(255),
});

export const LogoutSchema = z.object({
  refresh_token: z.string().min(1),
});

export const ChangePasscodeSchema = z
  .object({
    current_passcode: z.string().regex(passcodeRegex),
    new_passcode: z.string().regex(passcodeRegex),
  })
  .refine((d) => d.current_passcode !== d.new_passcode, {
    message: 'New passcode must differ from current',
    path: ['new_passcode'],
  });

export const ForgotPasscodeSchema = z.object({
  contact: z.string().min(1),
  contact_type: z.enum(['phone', 'email']),
});

export const ResetPasscodeSchema = z.object({
  reset_token: z.string().min(1),
  otp: z.string().regex(otpRegex),
  new_passcode: z.string().regex(passcodeRegex),
  device_id: z.string().min(1).max(255),
  fcm_token: z.string().min(1).max(512),
});

export const SetTransactionPinSchema = z.object({
  transaction_pin: z.string().regex(pinRegex, 'PIN must be exactly 4 digits'),
});

export const InitiatePinResetSchema = z.object({
  // No body required — user is authenticated, we use their registered contact
});

export const ConfirmPinResetSchema = z.object({
  otp: z.string().regex(/^\d{6}$/, 'OTP must be exactly 6 digits'),
  reset_token: z.string().min(1, 'Reset token is required'),
});

export const CompletePinResetSchema = z
  .object({
    reset_token: z.string().min(1, 'Reset token is required'),
    new_pin: z.string().regex(pinRegex, 'PIN must be exactly 4 digits'),
    confirm_pin: z.string().regex(pinRegex, 'PIN must be exactly 4 digits'),
  })
  .refine((d) => d.new_pin === d.confirm_pin, {
    message: 'PINs do not match',
    path: ['confirm_pin'],
  });

export const SetUppSchema = z.object({
  upp: z.string().regex(uppRegex, 'Universal Payment PIN must be exactly 6 digits'),
});

export const InitiateUppResetSchema = z.object({
  // No body required — OTP sent to registered contact
});

export const ConfirmUppResetSchema = z.object({
  otp: z.string().regex(/^\d{6}$/, 'OTP must be exactly 6 digits'),
  reset_token: z.string().min(1, 'Reset token is required'),
});

export const CompleteUppResetSchema = z
  .object({
    reset_token: z.string().min(1, 'Reset token is required'),
    new_upp: z.string().regex(uppRegex, 'Universal Payment PIN must be exactly 6 digits'),
    confirm_upp: z.string().regex(uppRegex, 'Universal Payment PIN must be exactly 6 digits'),
  })
  .refine((d) => d.new_upp === d.confirm_upp, {
    message: 'PINs do not match',
    path: ['confirm_upp'],
  });

export const RevokeUniversalIdSchema = z.object({
  login_passcode: z.string().regex(passcodeRegex, 'Login passcode required to revoke Universal ID'),
});

// Inferred types
export type InitiateRegistrationInput = z.infer<typeof InitiateRegistrationSchema>;
export type VerifyOtpInput = z.infer<typeof VerifyOtpSchema>;
export type CheckUsernameInput = z.infer<typeof CheckUsernameSchema>;
export const UnlockSchema = z.object({
  refresh_token: z.string().min(1, 'Refresh token is required'),
  login_passcode: z.string().regex(passcodeRegex, 'Passcode must be exactly 6 digits'),
});

export type CompleteRegistrationInput = z.infer<typeof CompleteRegistrationSchema>;
export type ResendOtpInput = z.infer<typeof ResendOtpSchema>;
export type LoginInput = z.infer<typeof LoginSchema>;
export type RefreshTokenInput = z.infer<typeof RefreshTokenSchema>;
export type LogoutInput = z.infer<typeof LogoutSchema>;
export type ChangePasscodeInput = z.infer<typeof ChangePasscodeSchema>;
export type ForgotPasscodeInput = z.infer<typeof ForgotPasscodeSchema>;
export type ResetPasscodeInput = z.infer<typeof ResetPasscodeSchema>;
export type SetTransactionPinInput = z.infer<typeof SetTransactionPinSchema>;
export type ConfirmPinResetInput = z.infer<typeof ConfirmPinResetSchema>;
export type CompletePinResetInput = z.infer<typeof CompletePinResetSchema>;
export type SetUppInput = z.infer<typeof SetUppSchema>;
export type ConfirmUppResetInput = z.infer<typeof ConfirmUppResetSchema>;
export type CompleteUppResetInput = z.infer<typeof CompleteUppResetSchema>;
export type RevokeUniversalIdInput = z.infer<typeof RevokeUniversalIdSchema>;
