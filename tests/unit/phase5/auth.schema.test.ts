/**
 * Phase 5 — Auth Zod schema tests
 */

import {
  InitiateRegistrationSchema,
  VerifyOtpSchema,
  CompleteRegistrationSchema,
  LoginSchema,
  ChangePasscodeSchema,
  SetTransactionPinSchema,
  CompletePinResetSchema,
  SetUppSchema,
  CompleteUppResetSchema,
  ForgotPasscodeSchema,
  ResetPasscodeSchema,
} from '../../../src/features/auth/auth.schema';

// ---------------------------------------------------------------------------
// InitiateRegistrationSchema
// ---------------------------------------------------------------------------

describe('InitiateRegistrationSchema', () => {
  it('accepts valid phone', () =>
    expect(
      InitiateRegistrationSchema.safeParse({ contact: '+2348012345678', contact_type: 'phone' })
        .success,
    ).toBe(true));
  it('accepts valid email', () =>
    expect(
      InitiateRegistrationSchema.safeParse({ contact: 'user@example.com', contact_type: 'email' })
        .success,
    ).toBe(true));
  it('rejects invalid phone (no +234)', () =>
    expect(
      InitiateRegistrationSchema.safeParse({ contact: '08012345678', contact_type: 'phone' })
        .success,
    ).toBe(false));
  it('rejects invalid email', () =>
    expect(
      InitiateRegistrationSchema.safeParse({ contact: 'not-an-email', contact_type: 'email' })
        .success,
    ).toBe(false));
  it('rejects unknown contact_type', () =>
    expect(
      InitiateRegistrationSchema.safeParse({ contact: '+2348012345678', contact_type: 'telegram' })
        .success,
    ).toBe(false));
  it('rejects missing contact', () =>
    expect(InitiateRegistrationSchema.safeParse({ contact_type: 'phone' }).success).toBe(false));
});

// ---------------------------------------------------------------------------
// VerifyOtpSchema
// ---------------------------------------------------------------------------

describe('VerifyOtpSchema', () => {
  const base = {
    registration_id: '550e8400-e29b-41d4-a716-446655440000',
    otp: '123456',
    contact_type: 'phone',
  };

  it('accepts valid payload', () => expect(VerifyOtpSchema.safeParse(base).success).toBe(true));
  it('rejects non-UUID registration_id', () =>
    expect(VerifyOtpSchema.safeParse({ ...base, registration_id: 'not-a-uuid' }).success).toBe(
      false,
    ));
  it('rejects 5-digit OTP', () =>
    expect(VerifyOtpSchema.safeParse({ ...base, otp: '12345' }).success).toBe(false));
  it('rejects 7-digit OTP', () =>
    expect(VerifyOtpSchema.safeParse({ ...base, otp: '1234567' }).success).toBe(false));
  it('rejects non-digit OTP', () =>
    expect(VerifyOtpSchema.safeParse({ ...base, otp: 'abcdef' }).success).toBe(false));
  it('rejects missing otp', () =>
    expect(VerifyOtpSchema.safeParse({ registration_id: base.registration_id }).success).toBe(
      false,
    ));
});

// ---------------------------------------------------------------------------
// CompleteRegistrationSchema
// ---------------------------------------------------------------------------

describe('CompleteRegistrationSchema', () => {
  const base = {
    registration_id: '550e8400-e29b-41d4-a716-446655440000',
    username: 'valid_user',
    login_passcode: '123456',
    device_id: 'dev-001',
    fcm_token: 'fcm-token',
  };

  it('accepts valid payload', () =>
    expect(CompleteRegistrationSchema.safeParse(base).success).toBe(true));
  it('rejects username too short (< 5 chars)', () =>
    expect(CompleteRegistrationSchema.safeParse({ ...base, username: 'ab' }).success).toBe(false));
  it('rejects username with spaces', () =>
    expect(CompleteRegistrationSchema.safeParse({ ...base, username: 'hello world' }).success).toBe(
      false,
    ));
  it('rejects username with hyphens', () =>
    expect(CompleteRegistrationSchema.safeParse({ ...base, username: 'hello-world' }).success).toBe(
      false,
    ));
  it('accepts username with underscore', () =>
    expect(CompleteRegistrationSchema.safeParse({ ...base, username: 'hello_world' }).success).toBe(
      true,
    ));
  it('rejects 5-digit passcode', () =>
    expect(CompleteRegistrationSchema.safeParse({ ...base, login_passcode: '12345' }).success).toBe(
      false,
    ));
  it('rejects 7-digit passcode', () =>
    expect(
      CompleteRegistrationSchema.safeParse({ ...base, login_passcode: '1234567' }).success,
    ).toBe(false));
  it('rejects alpha passcode', () =>
    expect(
      CompleteRegistrationSchema.safeParse({ ...base, login_passcode: 'abcdef' }).success,
    ).toBe(false));
});

// ---------------------------------------------------------------------------
// LoginSchema
// ---------------------------------------------------------------------------

describe('LoginSchema', () => {
  const base = {
    contact: '+2348012345678',
    contact_type: 'phone',
    login_passcode: '123456',
    device_id: 'dev',
    fcm_token: 'tok',
  };

  it('accepts phone login', () => expect(LoginSchema.safeParse(base).success).toBe(true));
  it('accepts email login', () =>
    expect(
      LoginSchema.safeParse({ ...base, contact: 'user@example.com', contact_type: 'email' })
        .success,
    ).toBe(true));
  it('rejects missing passcode', () => {
    const { login_passcode: _, ...rest } = base;
    expect(LoginSchema.safeParse(rest).success).toBe(false);
  });
  it('rejects missing device_id', () => {
    const { device_id: _, ...rest } = base;
    expect(LoginSchema.safeParse(rest).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ChangePasscodeSchema
// ---------------------------------------------------------------------------

describe('ChangePasscodeSchema', () => {
  it('accepts valid change', () =>
    expect(
      ChangePasscodeSchema.safeParse({ current_passcode: '111111', new_passcode: '222222' })
        .success,
    ).toBe(true));
  it('rejects same passcode', () =>
    expect(
      ChangePasscodeSchema.safeParse({ current_passcode: '111111', new_passcode: '111111' })
        .success,
    ).toBe(false));
  it('rejects missing new', () =>
    expect(ChangePasscodeSchema.safeParse({ current_passcode: '111111' }).success).toBe(false));
});

// ---------------------------------------------------------------------------
// SetTransactionPinSchema — no login_passcode required
// ---------------------------------------------------------------------------

describe('SetTransactionPinSchema', () => {
  it('accepts valid 4-digit PIN', () =>
    expect(SetTransactionPinSchema.safeParse({ transaction_pin: '1234' }).success).toBe(true));
  it('rejects 3-digit PIN', () =>
    expect(SetTransactionPinSchema.safeParse({ transaction_pin: '123' }).success).toBe(false));
  it('rejects 5-digit PIN', () =>
    expect(SetTransactionPinSchema.safeParse({ transaction_pin: '12345' }).success).toBe(false));
  it('rejects alpha PIN', () =>
    expect(SetTransactionPinSchema.safeParse({ transaction_pin: 'abcd' }).success).toBe(false));
  it('rejects missing PIN', () =>
    expect(SetTransactionPinSchema.safeParse({}).success).toBe(false));
});

// ---------------------------------------------------------------------------
// CompletePinResetSchema
// ---------------------------------------------------------------------------

describe('CompletePinResetSchema', () => {
  it('accepts valid matching PINs', () =>
    expect(
      CompletePinResetSchema.safeParse({ reset_token: 'tok', new_pin: '2222', confirm_pin: '2222' })
        .success,
    ).toBe(true));
  it('rejects mismatched PINs', () =>
    expect(
      CompletePinResetSchema.safeParse({ reset_token: 'tok', new_pin: '1111', confirm_pin: '2222' })
        .success,
    ).toBe(false));
  it('rejects missing reset_token', () =>
    expect(CompletePinResetSchema.safeParse({ new_pin: '1111', confirm_pin: '1111' }).success).toBe(
      false,
    ));
  it('rejects 3-digit PIN', () =>
    expect(
      CompletePinResetSchema.safeParse({ reset_token: 'tok', new_pin: '111', confirm_pin: '111' })
        .success,
    ).toBe(false));
});

// ---------------------------------------------------------------------------
// SetUppSchema — no login_passcode required
// ---------------------------------------------------------------------------

describe('SetUppSchema', () => {
  it('accepts valid 6-digit UPP', () =>
    expect(SetUppSchema.safeParse({ upp: '654321' }).success).toBe(true));
  it('rejects 5-digit UPP', () =>
    expect(SetUppSchema.safeParse({ upp: '65432' }).success).toBe(false));
  it('rejects 7-digit UPP', () =>
    expect(SetUppSchema.safeParse({ upp: '6543210' }).success).toBe(false));
  it('rejects alpha UPP', () =>
    expect(SetUppSchema.safeParse({ upp: 'abcdef' }).success).toBe(false));
  it('rejects missing UPP', () => expect(SetUppSchema.safeParse({}).success).toBe(false));
});

// ---------------------------------------------------------------------------
// CompleteUppResetSchema
// ---------------------------------------------------------------------------

describe('CompleteUppResetSchema', () => {
  it('accepts valid matching UPPs', () =>
    expect(
      CompleteUppResetSchema.safeParse({
        reset_token: 'tok',
        new_upp: '654321',
        confirm_upp: '654321',
      }).success,
    ).toBe(true));
  it('rejects mismatched UPPs', () =>
    expect(
      CompleteUppResetSchema.safeParse({
        reset_token: 'tok',
        new_upp: '111111',
        confirm_upp: '222222',
      }).success,
    ).toBe(false));
  it('rejects missing reset_token', () =>
    expect(
      CompleteUppResetSchema.safeParse({ new_upp: '111111', confirm_upp: '111111' }).success,
    ).toBe(false));
  it('rejects 4-digit UPP', () =>
    expect(
      CompleteUppResetSchema.safeParse({ reset_token: 'tok', new_upp: '1111', confirm_upp: '1111' })
        .success,
    ).toBe(false));
});

// ---------------------------------------------------------------------------
// ForgotPasscodeSchema
// ---------------------------------------------------------------------------

describe('ForgotPasscodeSchema', () => {
  it('accepts phone', () =>
    expect(
      ForgotPasscodeSchema.safeParse({ contact: '+2348012345678', contact_type: 'phone' }).success,
    ).toBe(true));
  it('accepts email', () =>
    expect(
      ForgotPasscodeSchema.safeParse({ contact: 'user@example.com', contact_type: 'email' })
        .success,
    ).toBe(true));
  it('rejects missing', () => expect(ForgotPasscodeSchema.safeParse({}).success).toBe(false));
});

// ---------------------------------------------------------------------------
// ResetPasscodeSchema
// ---------------------------------------------------------------------------

describe('ResetPasscodeSchema', () => {
  const base = {
    reset_token: 'some-token',
    otp: '123456',
    new_passcode: '999999',
    device_id: 'dev',
    fcm_token: 'tok',
  };

  it('accepts valid reset', () => expect(ResetPasscodeSchema.safeParse(base).success).toBe(true));
  it('rejects empty reset_token', () =>
    expect(ResetPasscodeSchema.safeParse({ ...base, reset_token: '' }).success).toBe(false));
  it('rejects 5-digit passcode', () =>
    expect(ResetPasscodeSchema.safeParse({ ...base, new_passcode: '99999' }).success).toBe(false));
  it('rejects alpha passcode', () =>
    expect(ResetPasscodeSchema.safeParse({ ...base, new_passcode: 'abcdef' }).success).toBe(false));
});
