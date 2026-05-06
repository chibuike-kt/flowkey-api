import {
  generateUniversalId,
  isValidUniversalId,
  normaliseUniversalId,
  canRevokeUniversalId,
} from '../../../src/features/universal-id/universal-id.service';
import { WORDLIST } from '../../../src/data/universal-id-wordlist';

// existsCheck that always returns false (no collision)
const noCollision = jest.fn(async (_id: string) => false);

beforeEach(() => {
  noCollision.mockResolvedValue(false);
  // Re-spy after jest resetMocks clears spies set in setup.ts
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('Universal ID wordlist', () => {
  it('has no duplicate words', () => {
    expect(new Set(WORDLIST).size).toBe(WORDLIST.length);
  });

  it('all words are uppercase', () => {
    expect(WORDLIST.every((w) => w === w.toUpperCase())).toBe(true);
  });

  it('all words are 4–6 letters', () => {
    expect(WORDLIST.every((w) => w.length >= 4 && w.length <= 6)).toBe(true);
  });

  it('all words contain only letters', () => {
    expect(WORDLIST.every((w) => /^[A-Z]+$/.test(w))).toBe(true);
  });

  it('wordlist has at least 500 words', () => {
    expect(WORDLIST.length).toBeGreaterThanOrEqual(500);
  });

  it('address space exceeds 2 billion', () => {
    const space = BigInt(WORDLIST.length) * BigInt(676) * BigInt(10000);
    expect(space).toBeGreaterThan(BigInt(2_000_000_000));
  });
});

describe('generateUniversalId', () => {
  it('generates WORD-XX-NNNN format', async () => {
    const id = await generateUniversalId(noCollision);
    expect(id).toMatch(/^[A-Z]{4,6}-[A-Z]{2}-\d{4}$/);
  });

  it('retries on collision', async () => {
    let calls = 0;
    const checkWithCollision = jest.fn(async () => {
      calls++;
      return calls <= 2; // first 2 calls return true (collision), 3rd returns false
    });
    const id = await generateUniversalId(checkWithCollision);
    expect(id).toMatch(/^[A-Z]{4,6}-[A-Z]{2}-\d{4}$/);
    expect(calls).toBe(3);
  });

  it('throws after max attempts', async () => {
    const alwaysCollide = jest.fn(async () => true);
    await expect(generateUniversalId(alwaysCollide)).rejects.toThrow();
  });

  it('suffix is always 4 digits', async () => {
    const id = await generateUniversalId(noCollision);
    expect(id.split('-')[2]).toMatch(/^\d{4}$/);
  });

  it('second segment is always 2 letters', async () => {
    const id = await generateUniversalId(noCollision);
    expect(id.split('-')[1]).toMatch(/^[A-Z]{2}$/);
  });

  it('first segment is from the wordlist', async () => {
    const id = await generateUniversalId(noCollision);
    expect(WORDLIST).toContain(id.split('-')[0]);
  });
});

describe('isValidUniversalId', () => {
  it('accepts valid WORD-XX-NNNN format', () => {
    expect(isValidUniversalId('BOLT-KP-4821')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isValidUniversalId('bolt-kp-4821')).toBe(true);
  });

  it('strips whitespace', () => {
    expect(isValidUniversalId('  BOLT-KP-4821  ')).toBe(true);
  });

  it('rejects old WORD-WORD-NNNN format', () => {
    expect(isValidUniversalId('BOLT-KING-4821')).toBe(false);
  });

  it('rejects wrong suffix length', () => {
    expect(isValidUniversalId('BOLT-KP-482')).toBe(false);
  });

  it('rejects 3-letter second segment', () => {
    expect(isValidUniversalId('BOLT-KPX-4821')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isValidUniversalId('')).toBe(false);
  });
});

describe('normaliseUniversalId', () => {
  it('uppercases and strips whitespace', () => {
    expect(normaliseUniversalId('  bolt-kp-4821  ')).toBe('BOLT-KP-4821');
  });
});

describe('canRevokeUniversalId', () => {
  it('returns true when never revoked', () => {
    expect(canRevokeUniversalId(null)).toBe(true);
  });

  it('returns false within 24 hours', () => {
    expect(canRevokeUniversalId(new Date(Date.now() - 1 * 60 * 60 * 1000))).toBe(false);
  });

  it('returns true after 24 hours', () => {
    expect(canRevokeUniversalId(new Date(Date.now() - 25 * 60 * 60 * 1000))).toBe(true);
  });
});
