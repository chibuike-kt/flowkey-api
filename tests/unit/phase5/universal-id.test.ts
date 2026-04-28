/**
 * Phase 5 — Universal ID unit tests
 */

import {
  generateUniversalId,
  isValidUniversalId,
  normaliseUniversalId,
} from '../../../src/features/universal-id/universal-id.service';
import { UNIVERSAL_ID_WORDLIST, WORDLIST_SIZE } from '../../../src/data/universal-id-wordlist';

// ---------------------------------------------------------------------------
// Wordlist integrity
// ---------------------------------------------------------------------------

describe('Universal ID wordlist', () => {
  it('has no duplicate words', () => {
    const set = new Set(UNIVERSAL_ID_WORDLIST);
    expect(set.size).toBe(UNIVERSAL_ID_WORDLIST.length);
  });

  it('all words are uppercase', () => {
    for (const word of UNIVERSAL_ID_WORDLIST) {
      expect(word).toBe(word.toUpperCase());
    }
  });

  it('all words are between 3 and 10 characters', () => {
    for (const word of UNIVERSAL_ID_WORDLIST) {
      expect(word.length).toBeGreaterThanOrEqual(3);
      expect(word.length).toBeLessThanOrEqual(10);
    }
  });

  it('all words contain only letters', () => {
    for (const word of UNIVERSAL_ID_WORDLIST) {
      expect(word).toMatch(/^[A-Z]+$/);
    }
  });

  it('wordlist has at least 500 words', () => {
    expect(WORDLIST_SIZE).toBeGreaterThanOrEqual(500);
  });

  it('address space is at least 1 billion combinations', () => {
    const space = WORDLIST_SIZE * WORDLIST_SIZE * 10_000;
    expect(space).toBeGreaterThan(1_000_000_000);
  });
});

// ---------------------------------------------------------------------------
// ID generation
// ---------------------------------------------------------------------------

describe('generateUniversalId', () => {
  it('generates a valid Universal ID format', async () => {
    const id = await generateUniversalId(async () => false);
    expect(id).toMatch(/^[A-Z]+-[A-Z]+-\d{4}$/);
  });

  it('retries when a collision occurs', async () => {
    let callCount = 0;
    const id = await generateUniversalId(async () => {
      callCount++;
      return callCount < 3; // first two are collisions
    });
    expect(callCount).toBeGreaterThanOrEqual(3);
    expect(id).toMatch(/^[A-Z]+-[A-Z]+-\d{4}$/);
  });

  it('throws after max attempts exhausted', async () => {
    await expect(
      generateUniversalId(async () => true), // always collides
    ).rejects.toThrow('Failed to generate a unique Universal ID');
  });

  it('generates IDs with 4-digit zero-padded suffix', async () => {
    const ids = await Promise.all(
      Array.from({ length: 20 }, () => generateUniversalId(async () => false)),
    );
    for (const id of ids) {
      const parts = id.split('-');
      const suffix = parts[parts.length - 1];
      expect(suffix).toMatch(/^\d{4}$/);
      expect(suffix?.length).toBe(4);
    }
  });

  it('generates unique IDs across multiple calls', async () => {
    const ids = await Promise.all(
      Array.from({ length: 100 }, () => generateUniversalId(async () => false)),
    );
    const unique = new Set(ids);
    // Cryptographically random — collision rate should be near-zero
    // Allow at most 1 collision in 100 (extremely unlikely)
    expect(unique.size).toBeGreaterThanOrEqual(99);
  });

  it('only uses words from the wordlist', async () => {
    const wordSet = new Set(UNIVERSAL_ID_WORDLIST);
    for (let i = 0; i < 20; i++) {
      const id = await generateUniversalId(async () => false);
      const parts = id.split('-');
      expect(parts.length).toBe(3);
      expect(wordSet.has(parts[0] ?? '')).toBe(true);
      expect(wordSet.has(parts[1] ?? '')).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

describe('isValidUniversalId', () => {
  it('accepts valid format', () => {
    expect(isValidUniversalId('SILVER-BOLT-8182')).toBe(true);
    expect(isValidUniversalId('AZURE-CRANE-0001')).toBe(true);
    expect(isValidUniversalId('A-B-0000')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isValidUniversalId('silver-bolt-8182')).toBe(true);
    expect(isValidUniversalId('Silver-Bolt-8182')).toBe(true);
  });

  it('strips surrounding whitespace', () => {
    expect(isValidUniversalId('  SILVER-BOLT-8182  ')).toBe(true);
  });

  it('rejects incorrect formats', () => {
    expect(isValidUniversalId('SILVER-BOLT-818')).toBe(false); // 3-digit suffix
    expect(isValidUniversalId('SILVER-BOLT-81820')).toBe(false); // 5-digit suffix
    expect(isValidUniversalId('SILVERBOLT-8182')).toBe(false); // missing separator
    expect(isValidUniversalId('SILVER-BOLT-ABCD')).toBe(false); // non-digit suffix
    expect(isValidUniversalId('')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

describe('normaliseUniversalId', () => {
  it('uppercases and strips whitespace', () => {
    expect(normaliseUniversalId('  silver-bolt-8182  ')).toBe('SILVER-BOLT-8182');
  });

  it('already uppercase input unchanged', () => {
    expect(normaliseUniversalId('SILVER-BOLT-8182')).toBe('SILVER-BOLT-8182');
  });
});
