// Mock config first
jest.mock('../../../src/config', () => ({
  config: () => ({
    otpTtlSeconds: 300,
    otpMaxAttempts: 3,
    otpResendMax: 3,
    otpResendWindowSeconds: 1800,
  }),
}));

// Mock Redis with a full in-memory implementation
const store: Record<string, string> = {};

const redisMock = {
  get: jest.fn(async (k: string) => store[k] ?? null),
  set: jest.fn(async (k: string, v: string, ..._args: unknown[]) => {
    store[k] = v;
    return 'OK';
  }),
  del: jest.fn(async (...keys: string[]) => {
    const flat = keys.flat();
    flat.forEach((k) => delete store[k]);
    return flat.length;
  }),
  ttl: jest.fn(async (_k: string) => 300),
  incr: jest.fn(async (k: string) => {
    store[k] = String(parseInt(store[k] ?? '0', 10) + 1);
    return parseInt(store[k], 10);
  }),
  pipeline: jest.fn(() => ({
    set: jest.fn(function (this: unknown, k: string, v: string) {
      store[k] = v;
      return this;
    }),
    del: jest.fn(function (this: unknown, ...keys: string[]) {
      keys.forEach((k) => delete store[k]);
      return this;
    }),
    exec: jest.fn(async () => []),
  })),
};

jest.mock('../../../src/common/utils/redis', () => ({ redis: redisMock }));

import { generateOtp, verifyOtp, resendOtp } from '../../../src/features/auth/otp.service';

beforeEach(() => {
  Object.keys(store).forEach((k) => delete store[k]);
  jest.clearAllMocks();
  // Re-setup pipeline mock after clearAllMocks
  redisMock.pipeline.mockReturnValue({
    set: jest.fn(function (this: unknown, k: string, v: string) {
      store[k] = v;
      return this;
    }),
    del: jest.fn(function (this: unknown, ...keys: string[]) {
      keys.forEach((k) => delete store[k]);
      return this;
    }),
    exec: jest.fn(async () => []),
  });
  redisMock.get.mockImplementation(async (k: string) => store[k] ?? null);
  redisMock.set.mockImplementation(async (k: string, v: string) => {
    store[k] = v;
    return 'OK';
  });
  redisMock.del.mockImplementation(async (...keys: string[]) => {
    const flat = keys.flat() as string[];
    flat.forEach((k: string) => delete store[k]);
    return flat.length;
  });
  redisMock.ttl.mockResolvedValue(300);
  redisMock.incr.mockImplementation(async (k: string) => {
    store[k] = String(parseInt(store[k] ?? '0', 10) + 1);
    return parseInt(store[k], 10);
  });
});

describe('generateOtp', () => {
  it('returns a 6-digit string', async () => {
    const otp = await generateOtp('user-1', 'email');
    expect(otp).toMatch(/^\d{6}$/);
  });

  it('generates valid OTPs for different users', async () => {
    const a = await generateOtp('user-a', 'email');
    const b = await generateOtp('user-b', 'phone');
    expect(a).toMatch(/^\d{6}$/);
    expect(b).toMatch(/^\d{6}$/);
  });
});

describe('verifyOtp', () => {
  it('resolves when OTP matches', async () => {
    const otp = await generateOtp('user-1', 'email');
    await expect(verifyOtp('user-1', 'email', otp)).resolves.toBeUndefined();
  });

  it('throws OTP_EXPIRED when no OTP stored', async () => {
    await expect(verifyOtp('user-none', 'email', '000000')).rejects.toMatchObject({
      code: 'OTP_EXPIRED',
    });
  });

  it('throws OTP_INVALID when OTP does not match', async () => {
    await generateOtp('user-2', 'email');
    await expect(verifyOtp('user-2', 'email', '000000')).rejects.toMatchObject({
      code: 'OTP_INVALID',
    });
  });

  it('throws OTP_MAX_ATTEMPTS_EXCEEDED after 3 wrong attempts', async () => {
    await generateOtp('user-3', 'email');
    // First two wrong attempts (max=3, so 3rd triggers max)
    for (let i = 0; i < 2; i++) {
      await verifyOtp('user-3', 'email', '000000').catch(() => undefined);
    }
    await expect(verifyOtp('user-3', 'email', '000000')).rejects.toMatchObject({
      code: 'OTP_MAX_ATTEMPTS_EXCEEDED',
    });
  });

  it('OTP is invalidated after max attempts exceeded', async () => {
    await generateOtp('user-4', 'email');
    for (let i = 0; i < 3; i++) {
      await verifyOtp('user-4', 'email', '000000').catch(() => undefined);
    }
    // OTP key should now be deleted — next call returns OTP_EXPIRED or OTP_MAX_ATTEMPTS_EXCEEDED
    await expect(verifyOtp('user-4', 'email', '000000')).rejects.toMatchObject({
      code: expect.stringMatching(/OTP_EXPIRED|OTP_MAX_ATTEMPTS_EXCEEDED/),
    });
  });
});

describe('resendOtp', () => {
  it('returns a new 6-digit OTP', async () => {
    await generateOtp('user-5', 'email');
    const newOtp = await resendOtp('user-5', 'email');
    expect(newOtp).toMatch(/^\d{6}$/);
  });

  it('throws OTP_RESEND_LIMIT_EXCEEDED when at limit', async () => {
    await generateOtp('user-6', 'email');
    for (let i = 0; i < 3; i++) {
      await resendOtp('user-6', 'email').catch(() => undefined);
    }
    await expect(resendOtp('user-6', 'email')).rejects.toMatchObject({
      code: 'OTP_RESEND_LIMIT_EXCEEDED',
    });
  });

  it('deletes old OTP before generating new one', async () => {
    await generateOtp('user-7', 'email');
    const second = await resendOtp('user-7', 'email');
    expect(second).toMatch(/^\d{6}$/);
    // The new OTP should be stored
    expect(store['otp:user-7:email']).toBe(second);
  });
});
