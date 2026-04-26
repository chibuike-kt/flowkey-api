/**
 * FlowKey — Universal ID Service
 *
 * Generates and validates Universal IDs in the format WORD-WORD-NNNN.
 * Collision-resistant: retries up to MAX_ATTEMPTS before alerting ops.
 * The wordlist is a versioned constant — never modified without a migration plan.
 */

import { randomInt } from 'crypto';
import { UNIVERSAL_ID_WORDLIST, WORDLIST_SIZE } from '../../data/universal-id-wordlist';
import { logger } from '../../common/utils/logger';

const MAX_GENERATION_ATTEMPTS = 5;
const SUFFIX_MIN = 0;
const SUFFIX_MAX = 9999;

// Regex for validating Universal ID format
const UNIVERSAL_ID_REGEX = /^[A-Z]+-[A-Z]+-\d{4}$/;

/**
 * Generate a candidate Universal ID.
 * Uses cryptographically random values — never sequential, never time-derived.
 */
function generateCandidate(): string {
  const word1 = UNIVERSAL_ID_WORDLIST[randomInt(0, WORDLIST_SIZE)];
  const word2 = UNIVERSAL_ID_WORDLIST[randomInt(0, WORDLIST_SIZE)];
  const suffix = randomInt(SUFFIX_MIN, SUFFIX_MAX + 1)
    .toString()
    .padStart(4, '0');
  return `${word1}-${word2}-${suffix}`;
}

/**
 * Generate a unique Universal ID.
 *
 * @param existsCheck - Async function that returns true if the ID already exists.
 *   Caller provides this to avoid coupling this service to Prisma directly.
 * @returns A unique Universal ID string.
 * @throws If MAX_GENERATION_ATTEMPTS are exhausted — signals wordlist exhaustion risk.
 */
export async function generateUniversalId(
  existsCheck: (id: string) => Promise<boolean>,
): Promise<string> {
  for (let attempt = 1; attempt <= MAX_GENERATION_ATTEMPTS; attempt++) {
    const candidate = generateCandidate();
    const exists = await existsCheck(candidate);

    if (!exists) {
      return candidate;
    }

    logger.warn('Universal ID collision — retrying', { attempt, candidate });
  }

  // Exhausted all attempts — this signals wordlist exhaustion risk
  // Alert ops and fail hard. Do not silently return a duplicate.
  logger.error('Universal ID generation failed after max attempts', {
    maxAttempts: MAX_GENERATION_ATTEMPTS,
    wordlistSize: WORDLIST_SIZE,
    alert: 'OPS_ALERT: Universal ID exhaustion risk. Wordlist expansion required.',
  });

  throw new Error(
    'Failed to generate a unique Universal ID after maximum attempts. ' +
      'This indicates wordlist exhaustion risk. Ops have been alerted.',
  );
}

/**
 * Validate Universal ID format.
 * Case-insensitive, whitespace-stripped before matching.
 */
export function isValidUniversalId(input: string): boolean {
  const normalised = input.trim().toUpperCase();
  return UNIVERSAL_ID_REGEX.test(normalised);
}

/**
 * Normalise a Universal ID for storage and comparison.
 * Always uppercase, whitespace stripped.
 */
export function normaliseUniversalId(input: string): string {
  return input.trim().toUpperCase();
}
