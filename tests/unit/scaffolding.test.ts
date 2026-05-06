import { successResponse, errorResponse } from '../../src/common/types/api';
import { AppError, ErrorCode } from '../../src/common/errors/AppError';

// ---------------------------------------------------------------------------
// ApiResponse helpers
// ---------------------------------------------------------------------------

describe('ApiResponse helpers', () => {
  describe('successResponse', () => {
    it('returns a well-formed success envelope', () => {
      const res = successResponse({ id: '123' });
      expect(res).toEqual({ success: true, data: { id: '123' }, meta: null, error: null });
    });

    it('accepts meta', () => {
      const res = successResponse({ id: '1' }, { page: 1 });
      expect(res.meta).toEqual({ page: 1 });
      expect(res.success).toBe(true);
    });

    it('accepts null data', () => {
      const res = successResponse(null);
      expect(res.data).toBeNull();
      expect(res.success).toBe(true);
    });
  });

  describe('errorResponse', () => {
    it('returns a well-formed error envelope', () => {
      const res = errorResponse('INVALID_CREDENTIALS', 'Bad credentials');
      expect(res).toEqual({
        success: false,
        data: null,
        meta: null,
        error: { code: 'INVALID_CREDENTIALS', message: 'Bad credentials' },
      });
    });

    it('data and meta are always null', () => {
      const res = errorResponse('NOT_FOUND', 'Not found');
      expect(res.data).toBeNull();
      expect(res.meta).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// AppError
// ---------------------------------------------------------------------------

describe('AppError', () => {
  it('creates an error with the correct code and HTTP status', () => {
    const err = new AppError(ErrorCode.NOT_FOUND, 'Resource not found');
    expect(err.code).toBe('NOT_FOUND');
    expect(err.message).toBe('Resource not found');
    expect(err.httpStatus).toBe(404);
  });

  it('isAppError returns true for AppError instances', () => {
    expect(AppError.isAppError(new AppError(ErrorCode.UNAUTHORIZED, 'Unauthorized'))).toBe(true);
  });

  it('isAppError returns false for plain Error instances', () => {
    expect(AppError.isAppError(new Error('plain'))).toBe(false);
  });

  it('isAppError returns false for non-Error values', () => {
    expect(AppError.isAppError(null)).toBe(false);
    expect(AppError.isAppError('string')).toBe(false);
    expect(AppError.isAppError(42)).toBe(false);
  });

  it('UNAUTHORIZED maps to HTTP 401', () => {
    expect(new AppError(ErrorCode.UNAUTHORIZED, '').httpStatus).toBe(401);
  });

  it('RATE_LIMITED maps to HTTP 429', () => {
    expect(new AppError(ErrorCode.RATE_LIMITED, '').httpStatus).toBe(429);
  });

  it('EXTERNAL_SERVICE_ERROR maps to HTTP 503', () => {
    expect(new AppError(ErrorCode.EXTERNAL_SERVICE_ERROR, '').httpStatus).toBe(503);
  });

  it('NOT_FOUND maps to HTTP 404', () => {
    expect(new AppError(ErrorCode.NOT_FOUND, '').httpStatus).toBe(404);
  });

  it('VALIDATION_ERROR maps to HTTP 422', () => {
    expect(new AppError(ErrorCode.VALIDATION_ERROR, '').httpStatus).toBe(422);
  });

  it('CONFLICT maps to HTTP 409', () => {
    expect(new AppError(ErrorCode.CONFLICT, '').httpStatus).toBe(409);
  });

  it('maintains proper prototype chain', () => {
    const err = new AppError(ErrorCode.FORBIDDEN, 'Forbidden');
    expect(err instanceof AppError).toBe(true);
    expect(err instanceof Error).toBe(true);
  });

  it('KYC_PROVIDER_UNAVAILABLE maps to HTTP 503', () => {
    expect(new AppError(ErrorCode.EXTERNAL_SERVICE_ERROR, '').httpStatus).toBe(503);
  });
});

// ---------------------------------------------------------------------------
// Config module
// ---------------------------------------------------------------------------

describe('Config module', () => {
  it('config() throws before initConfig() is called', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const cfg = require('../../src/config') as typeof import('../../src/config');
    cfg._resetConfigForTesting();
    expect(() => cfg.config()).toThrow('[Config]');
  });

  it('buildConfig reads NODE_ENV, PORT, and boolean flags from process.env', async () => {
    jest.resetModules();
    process.env['NODE_ENV'] = 'production';
    process.env['PORT'] = '4000';
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const cfg = require('../../src/config') as typeof import('../../src/config');
    cfg._resetConfigForTesting();
    await cfg.initConfig();
    const c = cfg.config();
    expect(c.isProduction).toBe(true);
    expect(c.isDevelopment).toBe(false);
    expect(c.port).toBe(4000);
    process.env['NODE_ENV'] = 'test';
    process.env['PORT'] = '3000';
  });

  it('requireEnv throws when a required variable is missing', () => {
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { requireEnv } = require('../../src/config') as typeof import('../../src/config');
    const key = 'DEFINITELY_MISSING_FLOWKEY_VAR';
    delete process.env[key];
    expect(() => requireEnv(key)).toThrow();
  });
});
