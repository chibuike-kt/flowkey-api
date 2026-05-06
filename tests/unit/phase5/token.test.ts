import * as crypto from 'crypto';
import { AppError } from '../../../src/common/errors/AppError';

// Generate real RS256 keys
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }) as string;

jest.mock('../../../src/config', () => ({
  config: () => ({
    jwtPrivateKey: privateKeyPem,
    jwtPublicKey: publicKeyPem,
    jwtAccessTokenTtl: 900,
    jwtIssuer: 'flowkey-test',
    jwtAudience: 'flowkey-test',
  }),
}));

// Import after mock is set
import {
  issueAccessToken,
  verifyAccessToken,
  generateRefreshToken,
} from '../../../src/features/auth/token.service';

const payload = { sub: 'user-abc', session_id: 'sess-1', device_id: 'dev-1' };

describe('issueAccessToken + verifyAccessToken', () => {
  it('issues a JWT that verifies correctly', () => {
    const token = issueAccessToken(payload);
    const decoded = verifyAccessToken(token);
    expect(decoded.sub).toBe('user-abc');
    expect(decoded.session_id).toBe('sess-1');
  });

  it('throws INVALID_TOKEN for a tampered token', () => {
    const token = issueAccessToken(payload);
    const tampered = token.slice(0, -5) + 'XXXXX';
    expect(() => verifyAccessToken(tampered)).toThrow(AppError);
    expect(() => verifyAccessToken(tampered)).toThrow(
      expect.objectContaining({ code: 'INVALID_TOKEN' }),
    );
  });

  it('decoded payload includes iat and exp', () => {
    const decoded = verifyAccessToken(issueAccessToken(payload));
    expect(decoded.iat).toBeDefined();
    expect(decoded.exp).toBeDefined();
  });

  it('exp - iat equals the configured TTL (900s)', () => {
    const decoded = verifyAccessToken(issueAccessToken(payload));
    expect(decoded.exp! - decoded.iat!).toBe(900);
  });

  it('sub matches what was passed in', () => {
    const decoded = verifyAccessToken(issueAccessToken(payload));
    expect(decoded.sub).toBe('user-abc');
  });
});

describe('generateRefreshToken', () => {
  it('returns raw token and its hash', () => {
    const { raw, hash } = generateRefreshToken();
    expect(raw).toBeDefined();
    expect(hash).toBeDefined();
  });

  it('raw token is 64 hex characters (256 bits)', () => {
    expect(generateRefreshToken().raw).toMatch(/^[0-9a-f]{64}$/);
  });

  it('hash is 64 hex characters (SHA-256)', () => {
    expect(generateRefreshToken().hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('generates unique tokens on each call', () => {
    const a = generateRefreshToken();
    const b = generateRefreshToken();
    expect(a.raw).not.toBe(b.raw);
    expect(a.hash).not.toBe(b.hash);
  });

  it('SHA-256 of raw matches the returned hash', () => {
    const { raw, hash } = generateRefreshToken();
    const expected = crypto.createHash('sha256').update(raw).digest('hex');
    expect(hash).toBe(expected);
  });

  it('different raw tokens produce different hashes', () => {
    expect(generateRefreshToken().hash).not.toBe(generateRefreshToken().hash);
  });
});
