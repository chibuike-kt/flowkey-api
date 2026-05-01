/**
 * Phase 5 — Universal ID unit tests (v2 format: WORD-XX-NNNN)
 */
import {
  generateUniversalId,
  isValidUniversalId,
  normaliseUniversalId,
  canRevokeUniversalId,
} from '../../../src/features/universal-id/universal-id.service';
import { WORDLIST, WORDLIST_SIZE } from '../../../src/data/universal-id-wordlist';

describe('Universal ID wordlist', () => {
  it('has no duplicate words', () => {
    expect(new Set(WORDLIST).size).toBe(WORDLIST_SIZE);
  });
  it('all words are uppercase', () => {
    for (const w of WORDLIST) expect(w).toBe(w.toUpperCase());
  });
  it('all words are 4–6 letters', () => {
    for (const w of WORDLIST) {
      expect(w.length).toBeGreaterThanOrEqual(4);
      expect(w.length).toBeLessThanOrEqual(6);
    }
  });
  it('all words contain only letters', () => {
    for (const w of WORDLIST) expect(w).toMatch(/^[A-Z]+$/);
  });
  it('wordlist has at least 500 words', () => {
    expect(WORDLIST_SIZE).toBeGreaterThanOrEqual(500);
  });
  it('address space exceeds 2 billion', () => {
    expect(WORDLIST_SIZE * 676 * 10_000).toBeGreaterThan(2_000_000_000);
  });
});

describe('generateUniversalId', () => {
  it('generates WORD-XX-NNNN format', async () => {
    const id = await generateUniversalId(async () => false);
    expect(id).toMatch(/^[A-Z]{4,6}-[A-Z]{2}-\d{4}$/);
  });
  it('retries on collision', async () => {
    let calls = 0;
    const id = await generateUniversalId(async () => {
      calls++;
      return calls < 3;
    });
    expect(calls).toBeGreaterThanOrEqual(3);
    expect(id).toMatch(/^[A-Z]{4,6}-[A-Z]{2}-\d{4}$/);
  });
  it('throws after max attempts', async () => {
    await expect(generateUniversalId(async () => true)).rejects.toThrow();
  });
  it('suffix is always 4 digits', async () => {
    for (let i = 0; i < 20; i++) {
      const id = await generateUniversalId(async () => false);
      const suffix = id.split('-')[2];
      expect(suffix).toMatch(/^\d{4}$/);
    }
  });
  it('second segment is always 2 letters', async () => {
    for (let i = 0; i < 20; i++) {
      const id = await generateUniversalId(async () => false);
      const seg2 = id.split('-')[1];
      expect(seg2).toMatch(/^[A-Z]{2}$/);
    }
  });
  it('first segment is from the wordlist', async () => {
    const wordSet = new Set(WORDLIST);
    for (let i = 0; i < 20; i++) {
      const id = await generateUniversalId(async () => false);
      expect(wordSet.has(id.split('-')[0]!)).toBe(true);
    }
  });
});

describe('isValidUniversalId', () => {
  it('accepts valid WORD-XX-NNNN format', () => {
    expect(isValidUniversalId('BOLT-KP-4821')).toBe(true);
    expect(isValidUniversalId('APEX-RZ-0034')).toBe(true);
    expect(isValidUniversalId('IRON-AB-0000')).toBe(true);
  });
  it('is case-insensitive', () => {
    expect(isValidUniversalId('bolt-kp-4821')).toBe(true);
  });
  it('strips whitespace', () => {
    expect(isValidUniversalId('  BOLT-KP-4821  ')).toBe(true);
  });
  it('rejects old WORD-WORD-NNNN format', () => {
    expect(isValidUniversalId('SILVER-BOLT-8182')).toBe(false);
  });
  it('rejects wrong suffix length', () => {
    expect(isValidUniversalId('BOLT-KP-482')).toBe(false);
    expect(isValidUniversalId('BOLT-KP-48210')).toBe(false);
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
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    expect(canRevokeUniversalId(oneHourAgo)).toBe(false);
  });
  it('returns true after 24 hours', () => {
    const twentyFiveHoursAgo = new Date(Date.now() - 25 * 60 * 60 * 1000);
    expect(canRevokeUniversalId(twentyFiveHoursAgo)).toBe(true);
  });
});
