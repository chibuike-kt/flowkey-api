/**
 * FlowKey — Universal ID Service v2
 *
 * Format: WORD-XX-NNNN
 *   Segment 1: 4–6 letter word from curated wordlist
 *   Segment 2: 2 cryptographically random uppercase letters (A-Z)
 *   Segment 3: 4-digit zero-padded cryptographically random number
 *
 * Address space: ~1098 × 676 × 10,000 = ~7.4 billion combinations
 *
 * Universal IDs are:
 *   - Auto-generated at account activation (user does not choose)
 *   - Used by the owner to authenticate payments on foreign devices
 *   - Revocable once per 24 hours; old IDs permanently retired
 *   - Never reassigned to another user
 */

import { randomInt } from 'crypto';
import { WORDLIST, WORDLIST_SIZE } from '../../data/universal-id-wordlist';
import { logger } from '../../common/utils/logger';

const MAX_ATTEMPTS = 5;
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const REVOKE_COOLDOWN_HOURS = 24;

function generateCandidate(): string {
  const word = WORDLIST[randomInt(0, WORDLIST_SIZE)]!;
  const l1 = LETTERS[randomInt(0, 26)]!;
  const l2 = LETTERS[randomInt(0, 26)]!;
  const num = randomInt(0, 10_000).toString().padStart(4, '0');
  return `${word}-${l1}${l2}-${num}`;
}

export async function generateUniversalId(
  existsCheck: (id: string) => Promise<boolean>,
): Promise<string> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const candidate = generateCandidate();
    const exists = await existsCheck(candidate);
    if (!exists) return candidate;
    logger.warn('Universal ID collision — retrying', { attempt, candidate });
  }
  logger.error('Universal ID exhaustion risk', {
    alert: 'OPS_ALERT',
    wordlistSize: WORDLIST_SIZE,
    maxAttempts: MAX_ATTEMPTS,
  });
  throw new Error('Failed to generate unique Universal ID after maximum attempts.');
}

export function isValidUniversalId(input: string): boolean {
  return /^[A-Z]{4,6}-[A-Z]{2}-\d{4}$/.test(input.trim().toUpperCase());
}

export function normaliseUniversalId(input: string): string {
  return input.trim().toUpperCase();
}

export function canRevokeUniversalId(lastRevokedAt: Date | null): boolean {
  if (!lastRevokedAt) return true;
  const cooldownMs = REVOKE_COOLDOWN_HOURS * 60 * 60 * 1000;
  return Date.now() - lastRevokedAt.getTime() >= cooldownMs;
}

export function nextRevocationAllowedAt(lastRevokedAt: Date): Date {
  return new Date(lastRevokedAt.getTime() + REVOKE_COOLDOWN_HOURS * 60 * 60 * 1000);
}
