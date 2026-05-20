import { successResponse, errorResponse } from '../../src/common/types/api';
import { AppError, ErrorCode } from '../../src/common/errors/AppError';

// ---------------------------------------------------------------------------
// ApiResponse helpers
// ---------------------------------------------------------------------------

describe('successResponse', () => {
  it('returns success envelope with data', () => {
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

  it('error is always null', () => {
    expect(successResponse({ x: 1 }).error).toBeNull();
  });
});

describe('errorResponse', () => {
  it('returns error envelope', () => {
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

  it('success is always false', () => {
    expect(errorResponse('X', 'Y').success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AppError
// ---------------------------------------------------------------------------

describe('AppError', () => {
  it('creates error with correct code and message', () => {
    const err = new AppError(ErrorCode.NOT_FOUND, 'Resource not found');
    expect(err.code).toBe('NOT_FOUND');
    expect(err.message).toBe('Resource not found');
    expect(err.httpStatus).toBe(404);
  });

  it('isAppError returns true for AppError instances', () => {
    expect(AppError.isAppError(new AppError(ErrorCode.UNAUTHORIZED, 'x'))).toBe(true);
  });

  it('isAppError returns false for plain Error', () => {
    expect(AppError.isAppError(new Error('plain'))).toBe(false);
  });

  it('isAppError returns false for non-Error values', () => {
    expect(AppError.isAppError(null)).toBe(false);
    expect(AppError.isAppError('string')).toBe(false);
    expect(AppError.isAppError(42)).toBe(false);
  });

  it('UNAUTHORIZED → 401', () =>
    expect(new AppError(ErrorCode.UNAUTHORIZED, '').httpStatus).toBe(401));
  it('FORBIDDEN → 403', () => expect(new AppError(ErrorCode.FORBIDDEN, '').httpStatus).toBe(403));
  it('NOT_FOUND → 404', () => expect(new AppError(ErrorCode.NOT_FOUND, '').httpStatus).toBe(404));
  it('CONFLICT → 409', () => expect(new AppError(ErrorCode.CONFLICT, '').httpStatus).toBe(409));
  it('VALIDATION_ERROR → 422', () =>
    expect(new AppError(ErrorCode.VALIDATION_ERROR, '').httpStatus).toBe(422));
  it('RATE_LIMITED → 429', () =>
    expect(new AppError(ErrorCode.RATE_LIMITED, '').httpStatus).toBe(429));
  it('EXTERNAL_SERVICE_ERROR → 503', () =>
    expect(new AppError(ErrorCode.EXTERNAL_SERVICE_ERROR, '').httpStatus).toBe(503));

  it('maintains proper prototype chain', () => {
    const err = new AppError(ErrorCode.FORBIDDEN, 'x');
    expect(err instanceof AppError).toBe(true);
    expect(err instanceof Error).toBe(true);
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

  it('initConfig reads PORT from process.env', async () => {
    jest.resetModules();
    process.env['PORT'] = '4567';
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const cfg = require('../../src/config') as typeof import('../../src/config');
    cfg._resetConfigForTesting();
    await cfg.initConfig();
    const c = cfg.config();
    expect(c.port).toBe(4567);
    expect(c.isProduction).toBe(false);
    expect(c.isDevelopment).toBe(false);
    process.env['PORT'] = '3000';
  });
});
