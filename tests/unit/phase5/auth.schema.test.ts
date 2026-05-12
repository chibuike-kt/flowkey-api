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
  ForgotPasscodeSchema,
  ResetPasscodeSchema,
} from '../../../src/features/auth/auth.schema';

describe('InitiateRegistrationSchema', () => {
  it('accepts valid phone', () => {
    expect(
      InitiateRegistrationSchema.safeParse({ contact: '+2348012345678', contact_type: 'phone' })
        .success,
    ).toBe(true);
  });

  it('accepts valid email', () => {
    expect(
      InitiateRegistrationSchema.safeParse({ contact: 'user@example.com', contact_type: 'email' })
        .success,
    ).toBe(true);
  });

  it('rejects invalid phone format', () => {
    expect(
      InitiateRegistrationSchema.safeParse({ contact: '08012345678', contact_type: 'phone' })
        .success,
    ).toBe(false);
  });

  it('rejects invalid email', () => {
    expect(
      InitiateRegistrationSchema.safeParse({ contact: 'not-an-email', contact_type: 'email' })
        .success,
    ).toBe(false);
  });

  it('rejects unknown contact_type', () => {
    expect(
      InitiateRegistrationSchema.safeParse({ contact: '+2348012345678', contact_type: 'telegram' })
        .success,
    ).toBe(false);
  });
});

describe('VerifyOtpSchema', () => {
  const base = {
    registration_id: '550e8400-e29b-41d4-a716-446655440000',
    otp: '123456',
    contact_type: 'phone',
  };

  it('accepts valid payload', () => {
    expect(VerifyOtpSchema.safeParse(base).success).toBe(true);
  });

  it('rejects non-UUID registration_id', () => {
    expect(VerifyOtpSchema.safeParse({ ...base, registration_id: 'not-a-uuid' }).success).toBe(
      false,
    );
  });

  it('rejects 5-digit OTP', () => {
    expect(VerifyOtpSchema.safeParse({ ...base, otp: '12345' }).success).toBe(false);
  });

  it('rejects non-digit OTP', () => {
    expect(VerifyOtpSchema.safeParse({ ...base, otp: 'abcdef' }).success).toBe(false);
  });
});

describe('CompleteRegistrationSchema', () => {
  const base = {
    registration_id: '550e8400-e29b-41d4-a716-446655440000',
    username: 'valid_user',
    login_passcode: '123456',
    device_id: 'dev-001',
    fcm_token: 'fcm-token',
  };

  it('accepts valid payload', () => {
    expect(CompleteRegistrationSchema.safeParse(base).success).toBe(true);
  });

  it('rejects username too short', () => {
    expect(CompleteRegistrationSchema.safeParse({ ...base, username: 'ab' }).success).toBe(false);
  });

  it('rejects username with spaces', () => {
    expect(CompleteRegistrationSchema.safeParse({ ...base, username: 'hello world' }).success).toBe(
      false,
    );
  });

  it('rejects username with special chars other than underscore', () => {
    expect(CompleteRegistrationSchema.safeParse({ ...base, username: 'hello-world' }).success).toBe(
      false,
    );
  });

  it('rejects 5-digit passcode', () => {
    expect(CompleteRegistrationSchema.safeParse({ ...base, login_passcode: '12345' }).success).toBe(
      false,
    );
  });
});

describe('LoginSchema', () => {
  const base = {
    contact: '+2348012345678',
    contact_type: 'phone',
    login_passcode: '123456',
    device_id: 'dev',
    fcm_token: 'tok',
  };

  it('accepts phone login', () => {
    expect(LoginSchema.safeParse(base).success).toBe(true);
  });

  it('accepts email login', () => {
    expect(
      LoginSchema.safeParse({ ...base, contact: 'user@example.com', contact_type: 'email' })
        .success,
    ).toBe(true);
  });

  it('rejects missing passcode', () => {
    const { login_passcode: _, ...rest } = base;
    expect(LoginSchema.safeParse(rest).success).toBe(false);
  });
});

describe('ChangePasscodeSchema', () => {
  it('accepts valid change', () => {
    expect(
      ChangePasscodeSchema.safeParse({ current_passcode: '111111', new_passcode: '222222' })
        .success,
    ).toBe(true);
  });

  it('rejects same passcode', () => {
    expect(
      ChangePasscodeSchema.safeParse({ current_passcode: '111111', new_passcode: '111111' })
        .success,
    ).toBe(false);
  });
});

describe('SetTransactionPinSchema', () => {
  it('accepts valid 4-digit PIN', () => {
    expect(
      SetTransactionPinSchema.safeParse({ login_passcode: '123456', transaction_pin: '1234' })
        .success,
    ).toBe(true);
  });

  it('rejects 5-digit PIN', () => {
    expect(
      SetTransactionPinSchema.safeParse({ login_passcode: '123456', transaction_pin: '12345' })
        .success,
    ).toBe(false);
  });
});

describe('CompletePinResetSchema', () => {
  it('accepts valid matching PINs', () => {
    expect(
      CompletePinResetSchema.safeParse({ reset_token: 'tok', new_pin: '2222', confirm_pin: '2222' })
        .success,
    ).toBe(true);
  });

  it('rejects mismatched PINs', () => {
    expect(
      CompletePinResetSchema.safeParse({ reset_token: 'tok', new_pin: '1111', confirm_pin: '2222' })
        .success,
    ).toBe(false);
  });

  it('rejects missing reset_token', () => {
    expect(CompletePinResetSchema.safeParse({ new_pin: '1111', confirm_pin: '1111' }).success).toBe(
      false,
    );
  });
});

describe('SetUppSchema', () => {
  it('accepts valid 6-digit UPP', () => {
    expect(SetUppSchema.safeParse({ login_passcode: '123456', upp: '654321' }).success).toBe(true);
  });

  it('rejects 5-digit UPP', () => {
    expect(SetUppSchema.safeParse({ login_passcode: '123456', upp: '65432' }).success).toBe(false);
  });
});

describe('ForgotPasscodeSchema', () => {
  it('accepts phone', () => {
    expect(
      ForgotPasscodeSchema.safeParse({ contact: '+2348012345678', contact_type: 'phone' }).success,
    ).toBe(true);
  });

  it('accepts email', () => {
    expect(
      ForgotPasscodeSchema.safeParse({ contact: 'user@example.com', contact_type: 'email' })
        .success,
    ).toBe(true);
  });
});

describe('ResetPasscodeSchema', () => {
  const base = {
    reset_token: 'some-token',
    otp: '123456',
    new_passcode: '999999',
    device_id: 'dev',
    fcm_token: 'tok',
  };

  it('accepts valid reset payload', () => {
    expect(ResetPasscodeSchema.safeParse(base).success).toBe(true);
  });

  it('rejects empty reset_token', () => {
    expect(ResetPasscodeSchema.safeParse({ ...base, reset_token: '' }).success).toBe(false);
  });
});
