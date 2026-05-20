import { config } from '../../config';
import { prisma } from '../../common/utils/prisma';
import { AppError, ErrorCode } from '../../common/errors/AppError';
import { logger } from '../../common/utils/logger';
import { kycAttemptsTotal } from '../../common/metrics/index';
import { verifyBvn, verifyNin, verifyAddress } from './prembly.provider';
import { queueKycResultEmail } from '../../queues/email.queue';
import {
  TIER_LIMITS,
  type KycTier,
  type KycStatusResult,
  type KycAttemptSummary,
  type UpgradeKycPayload,
} from './kyc.types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cooldownHours(targetTier: KycTier): number {
  const cfg = config();
  return targetTier === 2 ? cfg.kycCooldownTier1Hours : cfg.kycCooldownTier2PlusHours;
}

function cooldownUntil(targetTier: KycTier): Date {
  const ms = cooldownHours(targetTier) * 60 * 60 * 1000;
  return new Date(Date.now() + ms);
}

// ---------------------------------------------------------------------------
// GET /kyc/status
// ---------------------------------------------------------------------------

export async function getKycStatus(userId: string): Promise<KycStatusResult> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const user = await db.user.findUniqueOrThrow({
    where: { id: userId },
    select: { kyc_tier: true },
  });

  // Normalise: DB default was 0 before migration — treat 0 as tier 1
  const rawTier = (user as { kyc_tier: number }).kyc_tier;
  const tier = (rawTier < 1 ? 1 : rawTier) as KycTier;

  // Most recent attempt (any tier)
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const lastAttempt = await db.kycAttempt.findFirst({
    where: { user_id: userId },
    orderBy: { created_at: 'desc' },
    select: {
      id: true,
      tier_target: true,
      status: true,
      failure_reason: true,
      is_admin_override: true,
      created_at: true,
      updated_at: true,
      cooldown_until: true,
    },
  });

  const la = lastAttempt as {
    id: string;
    tier_target: number;
    status: string;
    failure_reason: string | null;
    is_admin_override: boolean;
    created_at: Date;
    updated_at: Date;
    cooldown_until: Date | null;
  } | null;

  const nextAttemptAllowedAt =
    la?.cooldown_until && la.cooldown_until > new Date() ? la.cooldown_until : null;

  const summary: KycAttemptSummary | null = la
    ? {
        id: la.id,
        tier_target: la.tier_target as KycTier,
        status: la.status as KycAttemptSummary['status'],
        failure_reason: la.failure_reason,
        is_admin_override: la.is_admin_override,
        created_at: la.created_at,
        updated_at: la.updated_at,
      }
    : null;

  return {
    current_tier: tier,
    limits: TIER_LIMITS[tier],
    last_attempt: summary,
    next_attempt_allowed_at: nextAttemptAllowedAt,
  };
}

// ---------------------------------------------------------------------------
// POST /kyc/upgrade
// ---------------------------------------------------------------------------

export async function upgradeKyc(
  userId: string,
  payload: UpgradeKycPayload,
): Promise<{ attempt_id: string; status: string; new_tier: KycTier | null }> {
  // 1. Load current tier
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const user = await db.user.findUniqueOrThrow({
    where: { id: userId },
    select: { kyc_tier: true },
  });
  // Normalise: treat tier 0 as tier 1 (pre-migration safety)
  const rawCurrentTier = (user as { kyc_tier: number }).kyc_tier;
  const currentTier = (rawCurrentTier < 1 ? 1 : rawCurrentTier) as KycTier;
  const targetTier = payload.target_tier;

  // 2. Sequential upgrade check
  if (targetTier !== currentTier + 1) {
    throw new AppError(
      ErrorCode.CONFLICT,
      `You must be on Tier ${targetTier - 1} before upgrading to Tier ${targetTier}. Your current tier is ${currentTier}.`,
    );
  }

  // 3. Already at target
  if (currentTier >= targetTier) {
    throw new AppError(ErrorCode.CONFLICT, `You are already on Tier ${currentTier}.`);
  }

  // 4. Cooldown check — look at the most recent attempt for this target tier
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const recentAttempt = await db.kycAttempt.findFirst({
    where: { user_id: userId, tier_target: targetTier, status: { in: ['failed', 'error'] } },
    orderBy: { created_at: 'desc' },
    select: { cooldown_until: true },
  });

  const ra = recentAttempt as { cooldown_until: Date | null } | null;
  if (ra?.cooldown_until && ra.cooldown_until > new Date()) {
    throw new AppError(
      ErrorCode.RATE_LIMITED,
      `You must wait until ${ra.cooldown_until.toISOString()} before retrying Tier ${targetTier} verification.`,
    );
  }

  // 5. Create attempt record (pending)
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const attempt = await db.kycAttempt.create({
    data: { user_id: userId, tier_target: targetTier, status: 'pending' },
    select: { id: true },
  });
  const attemptId = (attempt as { id: string }).id;

  // 6. Call Prembly
  try {
    if (targetTier === 2) {
      await processTier2(
        userId,
        attemptId,
        payload as Extract<UpgradeKycPayload, { target_tier: 2 }>,
      );
    } else {
      await processTier3(
        userId,
        attemptId,
        payload as Extract<UpgradeKycPayload, { target_tier: 3 }>,
      );
    }
  } catch (err) {
    // Service errors (EXTERNAL_SERVICE_ERROR etc.) propagate up
    // Mark attempt as error if we haven't already
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    await db.kycAttempt.updateMany({
      where: { id: attemptId, status: 'pending' },
      data: {
        status: 'error',
        failure_reason: err instanceof Error ? err.message : 'Unknown error',
      },
    });
    throw err;
  }

  // 7. Read final attempt status + user info for notification
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const finalAttempt = await db.kycAttempt.findUniqueOrThrow({
    where: { id: attemptId },
    select: { status: true, failure_reason: true },
  });
  const finalStatus = (finalAttempt as { status: string; failure_reason: string | null }).status;
  const failureReason = (finalAttempt as { status: string; failure_reason: string | null })
    .failure_reason;

  // 8. Queue KYC result notification — fire and forget
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const notifyUser = await db.user.findUnique({
    where: { id: userId },
    select: { email: true, phone: true, username: true },
  });
  const nu = notifyUser as {
    email: string | null;
    phone: string | null;
    username: string | null;
  } | null;
  if (nu?.email && nu.username) {
    void queueKycResultEmail(
      nu.email,
      nu.username,
      attemptId,
      targetTier,
      finalStatus === 'passed',
      failureReason ?? undefined,
    ).catch((err) =>
      logger.error('Failed to queue KYC result email', { error: (err as Error).message }),
    );
  }

  kycAttemptsTotal.inc({ tier_target: String(targetTier), status: finalStatus });

  return {
    attempt_id: attemptId,
    status: finalStatus,
    new_tier: finalStatus === 'passed' ? targetTier : null,
  };
}

// ---------------------------------------------------------------------------
// Internal — Tier 2 processing (BVN + NIN, both must pass)
// ---------------------------------------------------------------------------

async function processTier2(
  userId: string,
  attemptId: string,
  payload: Extract<UpgradeKycPayload, { target_tier: 2 }>,
): Promise<void> {
  const cfg = config();

  // Run BVN and NIN checks concurrently
  const [bvnResult, ninResult] = await Promise.all([
    verifyBvn(payload.bvn),
    verifyNin(payload.nin),
  ]);

  // Provider-level failure handling
  const providerFailed = !bvnResult.success || !ninResult.success;
  if (providerFailed) {
    if (cfg.isProduction) {
      await failAttempt(attemptId, 'Verification provider unavailable. Please try again.', 2);
      throw new AppError(
        ErrorCode.EXTERNAL_SERVICE_ERROR,
        'Verification service is temporarily unavailable. Please try again later.',
      );
    }
    // Dev fallback — log and treat as verified
    logger.warn('DEV KYC fallback — Prembly failed, treating as verified for local testing', {
      bvn_success: bvnResult.success,
      nin_success: ninResult.success,
    });
  }

  // Identity check — both must be verified
  const bvnVerified = bvnResult.success ? bvnResult.verified : true; // dev fallback
  const ninVerified = ninResult.success ? ninResult.verified : true; // dev fallback

  if (!bvnVerified || !ninVerified) {
    const reason = !bvnVerified
      ? 'BVN verification failed. Please check your BVN and try again.'
      : 'NIN verification failed. Please check your NIN and try again.';

    await failAttempt(attemptId, reason, 2);
    return;
  }

  // Both passed — upgrade tier atomically
  await passAttempt(userId, attemptId, 2, {
    bvn_reference: bvnResult.reference_id,
    nin_reference: ninResult.reference_id,
  });
}

// ---------------------------------------------------------------------------
// Internal — Tier 3 processing (Address + utility bill)
// ---------------------------------------------------------------------------

async function processTier3(
  userId: string,
  attemptId: string,
  payload: Extract<UpgradeKycPayload, { target_tier: 3 }>,
): Promise<void> {
  const cfg = config();

  const result = await verifyAddress(payload.address_line, payload.utility_bill_reference);

  if (!result.success) {
    if (cfg.isProduction) {
      await failAttempt(attemptId, 'Verification provider unavailable. Please try again.', 3);
      throw new AppError(
        ErrorCode.EXTERNAL_SERVICE_ERROR,
        'Verification service is temporarily unavailable. Please try again later.',
      );
    }
    logger.warn('DEV KYC fallback — Prembly address failed, treating as verified', {
      error: result.error,
    });
  }

  const verified = result.success ? result.verified : true; // dev fallback

  if (!verified) {
    await failAttempt(
      attemptId,
      'Address verification failed. Please check your details and try again.',
      3,
    );
    return;
  }

  await passAttempt(userId, attemptId, 3, {
    address_reference: result.reference_id,
    utility_bill_reference: payload.utility_bill_reference,
  });
}

// ---------------------------------------------------------------------------
// Internal — record pass, upgrade tier
// ---------------------------------------------------------------------------

async function passAttempt(
  userId: string,
  attemptId: string,
  newTier: KycTier,
  metadata: Record<string, unknown>,
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  await db.$transaction([
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    db.kycAttempt.update({
      where: { id: attemptId },
      data: { status: 'passed', metadata, cooldown_until: null },
    }),
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    db.user.update({
      where: { id: userId },
      data: { kyc_tier: newTier },
    }),
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    db.auditLog.create({
      data: {
        actor_id: userId,
        actor_type: 'user',
        action: `kyc.tier_${newTier}_passed`,
        target_type: 'user',
        target_id: userId,
        previous_hash: 'CHAINED',
        metadata: { attempt_id: attemptId, new_tier: newTier },
      },
    }),
  ]);
}

// ---------------------------------------------------------------------------
// Internal — record fail, set cooldown
// ---------------------------------------------------------------------------

async function failAttempt(attemptId: string, reason: string, targetTier: KycTier): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  await db.kycAttempt.update({
    where: { id: attemptId },
    data: {
      status: 'failed',
      failure_reason: reason,
      cooldown_until: cooldownUntil(targetTier),
    },
  });
}

// ---------------------------------------------------------------------------
// GET /kyc/attempts (paginated)
// ---------------------------------------------------------------------------

export async function listKycAttempts(
  userId: string,
  cursor?: string,
  limit = 20,
): Promise<{ attempts: KycAttemptSummary[]; next_cursor: string | null }> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const rows = await db.kycAttempt.findMany({
    where: { user_id: userId },
    orderBy: { created_at: 'desc' },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true,
      tier_target: true,
      status: true,
      failure_reason: true,
      is_admin_override: true,
      created_at: true,
      updated_at: true,
    },
  });

  const items = rows as Array<{
    id: string;
    tier_target: number;
    status: string;
    failure_reason: string | null;
    is_admin_override: boolean;
    created_at: Date;
    updated_at: Date;
  }>;

  const hasMore = items.length > limit;
  const page = hasMore ? items.slice(0, limit) : items;
  const nextCursor = hasMore ? (page[page.length - 1]?.id ?? null) : null;

  return {
    attempts: page.map((r) => ({
      id: r.id,
      tier_target: r.tier_target as KycTier,
      status: r.status as KycAttemptSummary['status'],
      failure_reason: r.failure_reason,
      is_admin_override: r.is_admin_override,
      created_at: r.created_at,
      updated_at: r.updated_at,
    })),
    next_cursor: nextCursor,
  };
}
