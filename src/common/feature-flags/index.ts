import { redis } from '../utils/redis';
import { logger } from '../utils/logger';

// ---------------------------------------------------------------------------
// Flag definitions with defaults
// ---------------------------------------------------------------------------

export type FeatureFlag =
  | 'deposits.virtual_account'
  | 'deposits.card'
  | 'kyc.tier2'
  | 'kyc.tier3'
  | 'transfers.bank'
  | 'transfers.internal'
  | 'transfers.qr'
  | 'beneficiaries'
  | 'qr_codes'
  | 'test.deposit';

const DEFAULT_FLAGS: Record<FeatureFlag, boolean> = {
  'deposits.virtual_account': true,
  'deposits.card': true,
  'kyc.tier2': true,
  'kyc.tier3': true,
  'transfers.bank': true,
  'transfers.internal': true,
  'transfers.qr': true,
  beneficiaries: true,
  qr_codes: true,
  'test.deposit': false,
};

const FLAG_PREFIX = 'fk:flags:';

// ---------------------------------------------------------------------------
// In-memory cache — reduces Redis round-trips to at most 1 per 5 seconds
// ---------------------------------------------------------------------------

interface CacheEntry {
  value: boolean;
  expiresAt: number;
}

const cache = new Map<FeatureFlag, CacheEntry>();
const CACHE_TTL_MS = 5_000;

function getCached(flag: FeatureFlag): boolean | null {
  const entry = cache.get(flag);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(flag);
    return null;
  }
  return entry.value;
}

function setCached(flag: FeatureFlag, value: boolean): void {
  cache.set(flag, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check if a feature flag is enabled.
 * Never throws — returns the default if Redis is unreachable.
 */
export async function isEnabled(flag: FeatureFlag): Promise<boolean> {
  const cached = getCached(flag);
  if (cached !== null) return cached;

  try {
    const raw = await redis.get(`${FLAG_PREFIX}${flag}`);

    // null → not set in Redis → use default
    const value = raw === null ? DEFAULT_FLAGS[flag] : raw === 'true';
    setCached(flag, value);
    return value;
  } catch (err) {
    logger.warn('Feature flag read failed — using default', {
      flag,
      default: DEFAULT_FLAGS[flag],
      error: err instanceof Error ? err.message : String(err),
    });
    return DEFAULT_FLAGS[flag] ?? true;
  }
}

/**
 * Set a feature flag. Admin only.
 */
export async function setFlag(flag: FeatureFlag, enabled: boolean): Promise<void> {
  await redis.set(`${FLAG_PREFIX}${flag}`, enabled ? 'true' : 'false');
  // Invalidate cache immediately
  cache.delete(flag);
  logger.info('Feature flag updated', { flag, enabled });
}

/**
 * Get all flags and their current values.
 */
export async function getAllFlags(): Promise<Record<FeatureFlag, boolean>> {
  const flags = Object.keys(DEFAULT_FLAGS) as FeatureFlag[];
  const result = {} as Record<FeatureFlag, boolean>;

  await Promise.all(
    flags.map(async (flag) => {
      result[flag] = await isEnabled(flag);
    }),
  );

  return result;
}

/**
 * Reset a flag to its default (delete from Redis).
 */
export async function resetFlag(flag: FeatureFlag): Promise<void> {
  await redis.del(`${FLAG_PREFIX}${flag}`);
  cache.delete(flag);
  logger.info('Feature flag reset to default', { flag, default: DEFAULT_FLAGS[flag] });
}
