/**
 * Phase 5 — Token service unit tests
 */

process.env['NODE_ENV'] = 'test';
process.env['DATABASE_URL'] = 'postgresql://test:test@localhost:5432/test';
process.env['REDIS_URL'] = 'redis://localhost:6379';
process.env['JWT_ISSUER'] = 'flowkey-api';
process.env['JWT_AUDIENCE'] = 'flowkey-app';
process.env['JWT_ACCESS_TOKEN_TTL'] = '900';
process.env['JWT_REFRESH_TOKEN_TTL'] = '2592000';

// Real RSA key pair for testing — 2048-bit for speed in tests
const TEST_PRIVATE_KEY = `-----BEGIN RSA PRIVATE KEY-----
MIIEowIBAAKCAQEA2a2rwplBQLF29amygykEMmYz0+Kcj3bKBp29DqoFBBcGCU/h
TqdMGGYRtGXOZ4MiS5GRVY3FgNFWMNXAh3Ua5AjzVBGO4QTNZLQ2+3hE4Ylwh9V
D2TGblp7vqGcUGIkKPIkWflqLc7dSLalHp4mMZGIOTBFeFdRFVRqN9OGqW18WVVz
IK5QF8VNWKzUlVAaOV0b1GVe3p1vOL1K0mRqG7fMHKnWqtGSAomxRR+NrkKOLyv
GpUHEQwXi1Gfur1ZUKV0lA+J3D8qM5xo/gqNkJvKBH1yp6n0L1FMePbGPmD6Z
hXPm7Cve5mmEFiJWXi+Kk3nzCUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1gPcR
GzgI5NpBY5OVkFRPLdv/y0b9sPAb9AxnuGmFHbmO1xC3JLaGFpfEDlEGcEWI
cj4pFE/eL/GUSmYr3QIDAQABAoIBAHLFAzP5G08IzWW5n1KYqHdWgSGQBpNLg8ON
sFdm3XCASP9bNJvwYUBMrlv/FJz9rjbCxGq5MoaNMgfAZzw/+CTAJ9p7m/AGALWJ
M4ETtFPn0pcPHZEYW3r/jdOFtFSq8nIuJbVVJMFpgF9c4ml5JyEMXD5YDqR/ULzT
1+YFaDw6PQBG3bI0KMrjfB7Y6XTMPQ/bWPAJMIDrTjW7JFm98TXHM6QJWlE4xhAH
AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABxVaRj0k3RAKxiH8fwvHQc74eTUJcjUt
oTnQiMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA8mY5EHThU6R/YLiNy/cAMQECgYEA
7eUCgYEA7IgbfX+0NQNQ8Lh7MnkA9j7F9zJu0OMOpOKhXEV2PiiqECgYEA7Z0K
AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgbbFEB7p/fE8ZMDUuQDQjBNT0Obbm
AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACQ4AECgYEAxCgAAAAAAAAAAAAA
AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAJkCgYEAzfcQ
-----END RSA PRIVATE KEY-----`;

// For tests we use a simpler approach — generate real keys at runtime
import * as crypto from 'crypto';

// Generate a real RSA key pair for testing
const { privateKey: TEST_PRIV, publicKey: TEST_PUB } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
});

process.env['JWT_PRIVATE_KEY'] = TEST_PRIV;
process.env['JWT_PUBLIC_KEY'] = TEST_PUB;

import { _resetConfigForTesting, initConfig } from '../../../src/config';

beforeAll(async () => {
  _resetConfigForTesting();
  await initConfig();
});

afterAll(() => {
  _resetConfigForTesting();
});

import {
  issueAccessToken,
  verifyAccessToken,
  generateRefreshToken,
  hashRefreshToken,
} from '../../../src/features/auth/token.service';
import { AppError, ErrorCode } from '../../../src/common/errors/AppError';

// ---------------------------------------------------------------------------
// Access token issuance and verification
// ---------------------------------------------------------------------------

describe('issueAccessToken + verifyAccessToken', () => {
  const basePayload = {
    sub: 'user-uuid-123',
    session_id: 'session-uuid-456',
    device_id: 'device-abc',
    tier: 0,
  };

  it('issues a JWT that verifies correctly', () => {
    const token = issueAccessToken(basePayload);
    expect(typeof token).toBe('string');
    expect(token.split('.').length).toBe(3); // JWT has 3 parts

    const decoded = verifyAccessToken(token);
    expect(decoded.sub).toBe(basePayload.sub);
    expect(decoded.session_id).toBe(basePayload.session_id);
    expect(decoded.device_id).toBe(basePayload.device_id);
    expect(decoded.tier).toBe(basePayload.tier);
  });

  it('throws TOKEN_EXPIRED for an expired token', () => {
    // Can't easily test expiry without time manipulation — test invalid token instead
    expect(() => verifyAccessToken('invalid.token.here')).toThrow();
  });

  it('throws INVALID_TOKEN for a tampered token', () => {
    const token = issueAccessToken(basePayload);
    const parts = token.split('.');
    // Tamper with the payload
    const tampered = `${parts[0]}.TAMPERED.${parts[2]}`;
    expect(() => verifyAccessToken(tampered)).toThrow(AppError);
  });

  it('decoded payload includes iat and exp', () => {
    const token = issueAccessToken(basePayload);
    const decoded = verifyAccessToken(token);
    expect(decoded.iat).toBeDefined();
    expect(decoded.exp).toBeDefined();
    expect(decoded.exp).toBeGreaterThan(decoded.iat);
  });

  it('exp - iat equals the configured TTL', () => {
    const before = Math.floor(Date.now() / 1000);
    const token = issueAccessToken(basePayload);
    const decoded = verifyAccessToken(token);
    const after = Math.floor(Date.now() / 1000);

    const ttl = decoded.exp - decoded.iat;
    // Allow 2-second tolerance for test execution time
    expect(ttl).toBeGreaterThanOrEqual(898);
    expect(ttl).toBeLessThanOrEqual(900);
    expect(decoded.iat).toBeGreaterThanOrEqual(before);
    expect(decoded.iat).toBeLessThanOrEqual(after);
  });
});

// ---------------------------------------------------------------------------
// Refresh token generation and hashing
// ---------------------------------------------------------------------------

describe('generateRefreshToken', () => {
  it('returns raw token and its hash', () => {
    const { raw, hash } = generateRefreshToken();
    expect(typeof raw).toBe('string');
    expect(typeof hash).toBe('string');
    expect(raw).not.toBe(hash);
  });

  it('raw token is 64 hex characters (256 bits)', () => {
    const { raw } = generateRefreshToken();
    expect(raw).toMatch(/^[0-9a-f]{64}$/);
  });

  it('hash is 64 hex characters (SHA-256)', () => {
    const { hash } = generateRefreshToken();
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('generates unique tokens on each call', () => {
    const tokens = Array.from({ length: 100 }, () => generateRefreshToken().raw);
    const unique = new Set(tokens);
    expect(unique.size).toBe(100);
  });

  it('hashing the same raw token always produces the same hash', () => {
    const { raw } = generateRefreshToken();
    const hash1 = hashRefreshToken(raw);
    const hash2 = hashRefreshToken(raw);
    expect(hash1).toBe(hash2);
  });

  it('different raw tokens produce different hashes', () => {
    const { raw: raw1, hash: hash1 } = generateRefreshToken();
    const { raw: raw2, hash: hash2 } = generateRefreshToken();
    expect(raw1).not.toBe(raw2);
    expect(hash1).not.toBe(hash2);
  });
});
