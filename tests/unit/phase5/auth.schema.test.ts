/**
 * Phase 5 — Auth schema unit tests (updated for new registration flow)
 */
import {
  InitiateRegistrationSchema,
  VerifyOtpSchema,
  CompleteRegistrationSchema,
  LoginSchema,
  ChangePasscodeSchema,
  SetTransactionPinSchema,
  ChangeTransactionPinSchema,
  ForgotPasscodeSchema,
  ResetPasscodeSchema,
  SetUppSchema,
} from '../../../src/features/auth/auth.schema';

describe('InitiateRegistrationSchema', () => {
  it('accepts valid phone', () => {
    expect(() =>
      InitiateRegistrationSchema.parse({ contact: '+2348012345678', contact_type: 'phone' }),
    ).not.toThrow();
  });
  it('accepts valid email', () => {
    expect(() =>
      InitiateRegistrationSchema.parse({ contact: 'test@example.com', contact_type: 'email' }),
    ).not.toThrow();
  });
  it('rejects invalid phone format', () => {
    expect(() =>
      InitiateRegistrationSchema.parse({ contact: '08012345678', contact_type: 'phone' }),
    ).toThrow();
  });
  it('rejects invalid email', () => {
    expect(() =>
      InitiateRegistrationSchema.parse({ contact: 'notanemail', contact_type: 'email' }),
    ).toThrow();
  });
  it('rejects unknown contact_type', () => {
    expect(() =>
      InitiateRegistrationSchema.parse({ contact: '+2348012345678', contact_type: 'sms' }),
    ).toThrow();
  });
});

describe('VerifyOtpSchema', () => {
  it('accepts valid payload', () => {
    expect(() =>
      VerifyOtpSchema.parse({
        registration_id: '123e4567-e89b-12d3-a456-426614174000',
        otp: '123456',
      }),
    ).not.toThrow();
  });
  it('rejects non-UUID registration_id', () => {
    expect(() => VerifyOtpSchema.parse({ registration_id: 'not-a-uuid', otp: '123456' })).toThrow();
  });
  it('rejects 5-digit OTP', () => {
    expect(() =>
      VerifyOtpSchema.parse({
        registration_id: '123e4567-e89b-12d3-a456-426614174000',
        otp: '12345',
      }),
    ).toThrow();
  });
  it('rejects non-digit OTP', () => {
    expect(() =>
      VerifyOtpSchema.parse({
        registration_id: '123e4567-e89b-12d3-a456-426614174000',
        otp: 'abcdef',
      }),
    ).toThrow();
  });
});

describe('CompleteRegistrationSchema', () => {
  const valid = {
    registration_id: '123e4567-e89b-12d3-a456-426614174000',
    username: 'kingsley_kt',
    login_passcode: '123456',
    device_id: 'device-abc',
    fcm_token: 'fcm-xyz',
  };
  it('accepts valid payload', () => {
    expect(() => CompleteRegistrationSchema.parse(valid)).not.toThrow();
  });
  it('rejects username too short', () => {
    expect(() => CompleteRegistrationSchema.parse({ ...valid, username: 'ab' })).toThrow();
  });
  it('rejects username with spaces', () => {
    expect(() => CompleteRegistrationSchema.parse({ ...valid, username: 'king sley' })).toThrow();
  });
  it('rejects username with special chars other than underscore', () => {
    expect(() => CompleteRegistrationSchema.parse({ ...valid, username: 'king@sley' })).toThrow();
  });
  it('rejects 5-digit passcode', () => {
    expect(() => CompleteRegistrationSchema.parse({ ...valid, login_passcode: '12345' })).toThrow();
  });
});

describe('LoginSchema', () => {
  it('accepts phone login', () => {
    expect(() =>
      LoginSchema.parse({
        contact: '+2348012345678',
        contact_type: 'phone',
        login_passcode: '123456',
        device_id: 'dev',
        fcm_token: 'fcm',
      }),
    ).not.toThrow();
  });
  it('accepts email login', () => {
    expect(() =>
      LoginSchema.parse({
        contact: 'user@example.com',
        contact_type: 'email',
        login_passcode: '123456',
        device_id: 'dev',
        fcm_token: 'fcm',
      }),
    ).not.toThrow();
  });
  it('rejects missing passcode', () => {
    expect(() =>
      LoginSchema.parse({
        contact: '+2348012345678',
        contact_type: 'phone',
        device_id: 'dev',
        fcm_token: 'fcm',
      }),
    ).toThrow();
  });
});

describe('ChangePasscodeSchema', () => {
  it('accepts valid change', () => {
    expect(() =>
      ChangePasscodeSchema.parse({ current_passcode: '111111', new_passcode: '222222' }),
    ).not.toThrow();
  });
  it('rejects same passcode', () => {
    expect(() =>
      ChangePasscodeSchema.parse({ current_passcode: '123456', new_passcode: '123456' }),
    ).toThrow();
  });
});

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
});

describe('ChangeTransactionPinSchema', () => {
  it('accepts valid change', () => {
    expect(() =>
      ChangeTransactionPinSchema.parse({ current_pin: '1234', new_pin: '5678' }),
    ).not.toThrow();
  });
  it('rejects same PIN', () => {
    expect(() =>
      ChangeTransactionPinSchema.parse({ current_pin: '1234', new_pin: '1234' }),
    ).toThrow();
  });
});

describe('SetUppSchema', () => {
  it('accepts valid 6-digit UPP', () => {
    expect(() => SetUppSchema.parse({ login_passcode: '123456', upp: '654321' })).not.toThrow();
  });
  it('rejects 5-digit UPP', () => {
    expect(() => SetUppSchema.parse({ login_passcode: '123456', upp: '12345' })).toThrow();
  });
});

describe('ForgotPasscodeSchema', () => {
  it('accepts phone', () => {
    expect(() =>
      ForgotPasscodeSchema.parse({ contact: '+2348099887766', contact_type: 'phone' }),
    ).not.toThrow();
  });
  it('accepts email', () => {
    expect(() =>
      ForgotPasscodeSchema.parse({ contact: 'user@example.com', contact_type: 'email' }),
    ).not.toThrow();
  });
});

describe('ResetPasscodeSchema', () => {
  it('accepts valid reset payload', () => {
    expect(() =>
      ResetPasscodeSchema.parse({
        reset_token: 'abc123',
        otp: '123456',
        new_passcode: '111222',
        device_id: 'dev',
        fcm_token: 'fcm',
      }),
    ).not.toThrow();
  });
  it('rejects empty reset_token', () => {
    expect(() =>
      ResetPasscodeSchema.parse({
        reset_token: '',
        otp: '123456',
        new_passcode: '111222',
        device_id: 'dev',
        fcm_token: 'fcm',
      }),
    ).toThrow();
  });
});
