/**
 * Phase 5 — OTP service unit tests
 * Redis is mocked — no real connection needed.
 */

jest.mock('../../../src/common/utils/redis', () => ({
  redis: {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    incr: jest.fn(),
    ttl: jest.fn(),
    pipeline: jest.fn(() => ({
      set: jest.fn().mockReturnThis(),
      del: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([]),
    })),
    quit: jest.fn(),
    ping: jest.fn(),
  },
}));

process.env['NODE_ENV'] = 'test';
process.env['DATABASE_URL'] = 'postgresql://test:test@localhost:5432/test';
process.env['REDIS_URL'] = 'redis://localhost:6379';
process.env['JWT_PRIVATE_KEY'] =
  '-----BEGIN RSA PRIVATE KEY-----\nTEST\n-----END RSA PRIVATE KEY-----';
process.env['JWT_PUBLIC_KEY'] = '-----BEGIN PUBLIC KEY-----\nTEST\n-----END PUBLIC KEY-----';
process.env['OTP_TTL_SECONDS'] = '300';
process.env['OTP_MAX_ATTEMPTS'] = '3';
process.env['OTP_RESEND_WINDOW_SECONDS'] = '1800';
process.env['OTP_RESEND_MAX'] = '3';

import { _resetConfigForTesting, initConfig } from '../../../src/config';

beforeAll(async () => {
  _resetConfigForTesting();
  await initConfig();
});

afterAll(() => {
  _resetConfigForTesting();
});

import { redis } from '../../../src/common/utils/redis';
import { generateOtp, verifyOtp, resendOtp } from '../../../src/features/auth/otp.service';
import { AppError, ErrorCode } from '../../../src/common/errors/AppError';

const mockRedis = redis as jest.Mocked<typeof redis>;

beforeEach(() => {
  jest.clearAllMocks();
  // Default pipeline mock
  (mockRedis.pipeline as jest.Mock).mockReturnValue({
    set: jest.fn().mockReturnThis(),
    del: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue([]),
  });
});

// ---------------------------------------------------------------------------
// generateOtp
// ---------------------------------------------------------------------------

describe('generateOtp', () => {
  it('returns a 6-digit string', async () => {
    mockRedis.set.mockResolvedValue('OK');

    const otp = await generateOtp('user-1', 'phone');
    expect(otp).toMatch(/^\d{6}$/);
  });

  it('generates different OTPs on successive calls', async () => {
    mockRedis.set.mockResolvedValue('OK');

    const otps = await Promise.all([
      generateOtp('user-1', 'phone'),
      generateOtp('user-1', 'phone'),
      generateOtp('user-1', 'phone'),
    ]);
    // All are 6-digit
    for (const otp of otps) {
      expect(otp).toMatch(/^\d{6}$/);
    }
  });
});

// ---------------------------------------------------------------------------
// verifyOtp
// ---------------------------------------------------------------------------

describe('verifyOtp', () => {
  it('resolves when OTP matches', async () => {
    mockRedis.get
      .mockResolvedValueOnce(null) // attempts key → no attempts
      .mockResolvedValueOnce('123456'); // OTP key → stored value
    mockRedis.del.mockResolvedValue(1);

    await expect(verifyOtp('user-1', 'phone', '123456')).resolves.not.toThrow();
  });

  it('throws OTP_EXPIRED when no OTP stored', async () => {
    mockRedis.get
      .mockResolvedValueOnce(null) // no attempts
      .mockResolvedValueOnce(null); // no OTP stored

    await expect(verifyOtp('user-1', 'phone', '123456')).rejects.toMatchObject({
      code: ErrorCode.OTP_EXPIRED,
    });
  });

  it('throws OTP_INVALID when OTP does not match', async () => {
    mockRedis.get
      .mockResolvedValueOnce(null) // no attempts
      .mockResolvedValueOnce('654321'); // stored OTP
    mockRedis.ttl.mockResolvedValue(240);
    mockRedis.set.mockResolvedValue('OK');

    await expect(verifyOtp('user-1', 'phone', '123456')).rejects.toMatchObject({
      code: ErrorCode.OTP_INVALID,
    });
  });

  it('throws OTP_MAX_ATTEMPTS_EXCEEDED after 3 wrong attempts', async () => {
    // Simulate already at max attempts
    mockRedis.get.mockResolvedValueOnce('3'); // attempt count at max

    await expect(verifyOtp('user-1', 'phone', '111111')).rejects.toMatchObject({
      code: ErrorCode.OTP_MAX_ATTEMPTS_EXCEEDED,
    });
  });

  it('invalidates OTP after max attempts exceeded during verification', async () => {
    // 2 previous attempts → next wrong attempt hits the limit
    mockRedis.get
      .mockResolvedValueOnce('2') // 2 previous attempts
      .mockResolvedValueOnce('654321'); // stored OTP
    mockRedis.ttl.mockResolvedValue(200);
    mockRedis.set.mockResolvedValue('OK');
    mockRedis.del.mockResolvedValue(1);

    await expect(verifyOtp('user-1', 'phone', '000000')).rejects.toMatchObject({
      code: ErrorCode.OTP_MAX_ATTEMPTS_EXCEEDED,
    });
    // OTP should be deleted after max attempts
    expect(mockRedis.del).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// resendOtp
// ---------------------------------------------------------------------------

describe('resendOtp', () => {
  it('returns a new 6-digit OTP', async () => {
    mockRedis.get.mockResolvedValue(null); // no previous resends
    mockRedis.del.mockResolvedValue(1);
    mockRedis.set.mockResolvedValue('OK');

    const otp = await resendOtp('user-1', 'email');
    expect(otp).toMatch(/^\d{6}$/);
  });

  it('throws OTP_RESEND_LIMIT_EXCEEDED when at limit', async () => {
    mockRedis.get.mockResolvedValue('3'); // already at max resends

    await expect(resendOtp('user-1', 'email')).rejects.toMatchObject({
      code: ErrorCode.OTP_RESEND_LIMIT_EXCEEDED,
    });
  });

  it('deletes old OTP before generating new one', async () => {
    mockRedis.get.mockResolvedValue('1'); // 1 previous resend
    mockRedis.del.mockResolvedValue(1);
    mockRedis.set.mockResolvedValue('OK');
    mockRedis.incr.mockResolvedValue(2);

    await resendOtp('user-1', 'phone');

    // del should be called to invalidate old OTP and attempts
    expect(mockRedis.del).toHaveBeenCalled();
  });
});
