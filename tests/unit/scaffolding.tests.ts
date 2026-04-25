/**
 * Phase 2 — Smoke tests
 *
 * Validates that the scaffolding compiles and core primitives work.
 * Not feature tests — those are added per phase.
 */

import { successResponse, errorResponse } from '../../src/common/types/api';
import { AppError, ErrorCode } from '../../src/common/errors/AppError';

// ---------------------------------------------------------------------------
// ApiResponse helpers
// ---------------------------------------------------------------------------

describe('ApiResponse helpers', () => {
  it('successResponse returns a well-formed success envelope', () => {
    const result = successResponse({ id: '123', name: 'test' });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ id: '123', name: 'test' });
    expect(result.error).toBeNull();
    expect(result.meta).toBeNull();
  });

  it('successResponse accepts meta', () => {
    const result = successResponse([], { cursor: 'abc', has_more: true });
    expect(result.meta).toEqual({ cursor: 'abc', has_more: true });
  });

  it('errorResponse returns a well-formed error envelope', () => {
    const result = errorResponse('SOME_CODE', 'Something went wrong');
    expect(result.success).toBe(false);
    expect(result.data).toBeNull();
    expect(result.meta).toBeNull();
    expect(result.error).toEqual({ code: 'SOME_CODE', message: 'Something went wrong' });
  });
});

// ---------------------------------------------------------------------------
// AppError
// ---------------------------------------------------------------------------

describe('AppError', () => {
  it('creates an error with the correct code and HTTP status', () => {
    const err = new AppError(ErrorCode.INSUFFICIENT_BALANCE, 'Not enough funds');
    expect(err.code).toBe(ErrorCode.INSUFFICIENT_BALANCE);
    expect(err.httpStatus).toBe(422);
    expect(err.message).toBe('Not enough funds');
    expect(err.isOperational).toBe(true);
  });

  it('isAppError returns true for AppError instances', () => {
    const err = new AppError(ErrorCode.NOT_FOUND, 'Not found');
    expect(AppError.isAppError(err)).toBe(true);
  });

  it('isAppError returns false for plain Error instances', () => {
    const err = new Error('plain error');
    expect(AppError.isAppError(err)).toBe(false);
  });

  it('isAppError returns false for non-Error values', () => {
    expect(AppError.isAppError(null)).toBe(false);
    expect(AppError.isAppError('string')).toBe(false);
    expect(AppError.isAppError(42)).toBe(false);
  });

  it('UNAUTHORIZED maps to HTTP 401', () => {
    const err = new AppError(ErrorCode.UNAUTHORIZED, 'Unauthorized');
    expect(err.httpStatus).toBe(401);
  });

  it('RATE_LIMITED maps to HTTP 429', () => {
    const err = new AppError(ErrorCode.RATE_LIMITED, 'Too many requests');
    expect(err.httpStatus).toBe(429);
  });

  it('KYC_PROVIDER_UNAVAILABLE maps to HTTP 503', () => {
    const err = new AppError(ErrorCode.KYC_PROVIDER_UNAVAILABLE, 'Prembly unavailable');
    expect(err.httpStatus).toBe(503);
  });

  it('maintains proper prototype chain for instanceof checks', () => {
    const err = new AppError(ErrorCode.NOT_FOUND, 'Not found');
    expect(err instanceof AppError).toBe(true);
    expect(err instanceof Error).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Config module
// Uses jest.resetModules() + require() — correct pattern for CommonJS Jest.
// Dynamic import() inside Jest CJS requires --experimental-vm-modules which
// we do not enable. require() achieves the same isolation.
// ---------------------------------------------------------------------------

describe('Config module', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('config() throws before initConfig() is called', () => {
    process.env['NODE_ENV'] = 'test';
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { _resetConfigForTesting, config } =
      require('../../src/config/index') as typeof import('../../src/config/index');
    _resetConfigForTesting();
    expect(() => config()).toThrow('[Config] config() called before initConfig()');
  });

  it('buildConfig reads NODE_ENV, PORT, and boolean flags from process.env', async () => {
    process.env['NODE_ENV'] = 'test';
    process.env['DATABASE_URL'] = 'postgresql://test:test@localhost:5432/test';
    process.env['REDIS_URL'] = 'redis://localhost:6379';
    process.env['JWT_PRIVATE_KEY'] =
      '-----BEGIN RSA PRIVATE KEY-----\nTEST\n-----END RSA PRIVATE KEY-----';
    process.env['JWT_PUBLIC_KEY'] = '-----BEGIN PUBLIC KEY-----\nTEST\n-----END PUBLIC KEY-----';
    process.env['PORT'] = '4000';

    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { initConfig, config, _resetConfigForTesting } =
      require('../../src/config/index') as typeof import('../../src/config/index');
    _resetConfigForTesting();

    await initConfig();
    const cfg = config();

    expect(cfg.nodeEnv).toBe('test');
    expect(cfg.isTest).toBe(true);
    expect(cfg.isProduction).toBe(false);
    expect(cfg.isDevelopment).toBe(false);
    expect(cfg.port).toBe(4000);

    _resetConfigForTesting();
  });

  it('requireEnv throws when a required variable is missing', async () => {
    process.env['NODE_ENV'] = 'test';
    // Deliberately omit DATABASE_URL
    delete process.env['DATABASE_URL'];

    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { initConfig, _resetConfigForTesting } =
      require('../../src/config/index') as typeof import('../../src/config/index');
    _resetConfigForTesting();

    await expect(initConfig()).rejects.toThrow('DATABASE_URL');
    _resetConfigForTesting();
  });
});
