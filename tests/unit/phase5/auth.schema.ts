/**
 * Phase 5 — Auth schema unit tests
 * Validates all Zod schemas accept valid input and reject invalid input correctly.
 */

import {
  RegisterSchema,
  VerifyOtpSchema,
  ResendOtpSchema,
  LoginSchema,
  RefreshTokenSchema,
  LogoutSchema,
  ChangePasscodeSchema,
  ForgotPasscodeSchema,
  ResetPasscodeSchema,
  SetTransactionPinSchema,
  ChangeTransactionPinSchema,
  DeleteTransactionPinSchema,
} from '../../../src/features/auth/auth.schema';

// ---------------------------------------------------------------------------
// RegisterSchema
// ---------------------------------------------------------------------------

describe('RegisterSchema', () => {
  const valid = {
    phone: '+2348012345678',
    email: 'test@example.com',
    display_name: 'Test User',
    login_passcode: '123456',
    device_id: 'device-abc-123',
    fcm_token: 'fcm-token-xyz',
  };

  it('accepts valid registration payload', () => {
    expect(() => RegisterSchema.parse(valid)).not.toThrow();
  });

  it('rejects invalid phone format', () => {
    expect(() => RegisterSchema.parse({ ...valid, phone: '08012345678' })).toThrow();
    expect(() => RegisterSchema.parse({ ...valid, phone: '+1234567890' })).toThrow();
    expect(() => RegisterSchema.parse({ ...valid, phone: '' })).toThrow();
  });

  it('rejects invalid email', () => {
    expect(() => RegisterSchema.parse({ ...valid, email: 'not-an-email' })).toThrow();
    expect(() => RegisterSchema.parse({ ...valid, email: '' })).toThrow();
  });

  it('rejects display_name too short', () => {
    expect(() => RegisterSchema.parse({ ...valid, display_name: 'A' })).toThrow();
  });

  it('rejects display_name too long', () => {
    expect(() => RegisterSchema.parse({ ...valid, display_name: 'A'.repeat(101) })).toThrow();
  });

  it('rejects non-6-digit passcode', () => {
    expect(() => RegisterSchema.parse({ ...valid, login_passcode: '12345' })).toThrow();
    expect(() => RegisterSchema.parse({ ...valid, login_passcode: '1234567' })).toThrow();
    expect(() => RegisterSchema.parse({ ...valid, login_passcode: 'abcdef' })).toThrow();
  });

  it('rejects empty device_id', () => {
    expect(() => RegisterSchema.parse({ ...valid, device_id: '' })).toThrow();
  });

  it('rejects empty fcm_token', () => {
    expect(() => RegisterSchema.parse({ ...valid, fcm_token: '' })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// VerifyOtpSchema
// ---------------------------------------------------------------------------

describe('VerifyOtpSchema', () => {
  const valid = {
    user_id: '123e4567-e89b-12d3-a456-426614174000',
    otp: '123456',
  };

  it('accepts valid payload', () => {
    expect(() => VerifyOtpSchema.parse(valid)).not.toThrow();
  });

  it('rejects invalid UUID', () => {
    expect(() => VerifyOtpSchema.parse({ ...valid, user_id: 'not-a-uuid' })).toThrow();
  });

  it('rejects non-6-digit OTP', () => {
    expect(() => VerifyOtpSchema.parse({ ...valid, otp: '12345' })).toThrow();
    expect(() => VerifyOtpSchema.parse({ ...valid, otp: 'abcdef' })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// LoginSchema
// ---------------------------------------------------------------------------

describe('LoginSchema', () => {
  const valid = {
    phone: '+2348012345678',
    login_passcode: '123456',
    device_id: 'device-abc',
    fcm_token: 'fcm-xyz',
  };

  it('accepts valid login payload', () => {
    expect(() => LoginSchema.parse(valid)).not.toThrow();
  });

  it('rejects missing phone', () => {
    const { phone: _, ...rest } = valid;
    expect(() => LoginSchema.parse(rest)).toThrow();
  });

  it('rejects 5-digit passcode', () => {
    expect(() => LoginSchema.parse({ ...valid, login_passcode: '12345' })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// ChangePasscodeSchema — refine check
// ---------------------------------------------------------------------------

describe('ChangePasscodeSchema', () => {
  it('accepts valid change payload', () => {
    expect(() =>
      ChangePasscodeSchema.parse({ current_passcode: '111111', new_passcode: '222222' }),
    ).not.toThrow();
  });

  it('rejects when current and new passcode are the same', () => {
    expect(() =>
      ChangePasscodeSchema.parse({ current_passcode: '123456', new_passcode: '123456' }),
    ).toThrow();
  });

  it('rejects non-digit passcode', () => {
    expect(() =>
      ChangePasscodeSchema.parse({ current_passcode: 'abc123', new_passcode: '654321' }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// SetTransactionPinSchema
// ---------------------------------------------------------------------------

describe('SetTransactionPinSchema', () => {
  it('accepts valid 4-digit PIN', () => {
    expect(() =>
      SetTransactionPinSchema.parse({ login_passcode: '123456', transaction_pin: '1234' }),
    ).not.toThrow();
  });

  it('rejects 5-digit PIN', () => {
    expect(() =>
      SetTransactionPinSchema.parse({ login_passcode: '123456', transaction_pin: '12345' }),
    ).toThrow();
  });

  it('rejects non-digit PIN', () => {
    expect(() =>
      SetTransactionPinSchema.parse({ login_passcode: '123456', transaction_pin: 'abcd' }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// ChangeTransactionPinSchema — refine check
// ---------------------------------------------------------------------------

describe('ChangeTransactionPinSchema', () => {
  it('accepts valid change', () => {
    expect(() =>
      ChangeTransactionPinSchema.parse({ current_pin: '1234', new_pin: '5678' }),
    ).not.toThrow();
  });

  it('rejects same current and new PIN', () => {
    expect(() =>
      ChangeTransactionPinSchema.parse({ current_pin: '1234', new_pin: '1234' }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// ResetPasscodeSchema
// ---------------------------------------------------------------------------

describe('ResetPasscodeSchema', () => {
  it('accepts valid reset payload', () => {
    expect(() =>
      ResetPasscodeSchema.parse({
        reset_token: 'abc123',
        phone_otp: '123456',
        email_otp: '654321',
        new_passcode: '111222',
      }),
    ).not.toThrow();
  });

  it('rejects empty reset_token', () => {
    expect(() =>
      ResetPasscodeSchema.parse({
        reset_token: '',
        phone_otp: '123456',
        email_otp: '654321',
        new_passcode: '111222',
      }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// ForgotPasscodeSchema
// ---------------------------------------------------------------------------

describe('ForgotPasscodeSchema', () => {
  it('accepts valid Nigerian phone', () => {
    expect(() => ForgotPasscodeSchema.parse({ phone: '+2348099887766' })).not.toThrow();
  });

  it('rejects non-Nigerian phone', () => {
    expect(() => ForgotPasscodeSchema.parse({ phone: '+12025550100' })).toThrow();
  });
});
