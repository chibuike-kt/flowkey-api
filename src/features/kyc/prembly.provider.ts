/**
 * FlowKey — Prembly Provider
 *
 * All Prembly API calls. Stubbed in dev/test, production code wired but
 * commented — activate by setting PREMBLY_API_BASE_URL + PREMBLY_API_KEY
 * and deploying with NODE_ENV=production.
 *
 * Pattern: never throws — always returns PremblyResult.
 * Environment-aware guard lives in kyc.service, not here.
 */

import { config } from '../../config';
import { logger } from '../../common/utils/logger';
import type { PremblyResult } from './kyc.types';

// ---------------------------------------------------------------------------
// Tier 2 — BVN verification
// ---------------------------------------------------------------------------

export async function verifyBvn(bvn: string): Promise<PremblyResult> {
  const cfg = config();

  if (!cfg.isProduction) {
    logger.info('[PREMBLY STUB] BVN verification → verified=true', {
      bvn: `${bvn.slice(0, 3)}****${bvn.slice(-2)}`,
    });
    return { success: true, verified: true, reference_id: `stub-bvn-${Date.now()}` };
  }

  try {
    // const res = await fetch(`${cfg.premblyApiBaseUrl}/api/v2/biometrics/merchant/data/verification/bvn`, {
    //   method: 'POST',
    //   headers: {
    //     'Content-Type': 'application/json',
    //     'app-id': cfg.premblyApiKey,
    //     'x-api-key': cfg.premblyApiKey,
    //   },
    //   body: JSON.stringify({ number: bvn }),
    //   signal: AbortSignal.timeout(cfg.premblyTimeoutMs),
    // });
    // const data = await res.json() as { status: boolean; reference_id?: string };
    // return { success: true, verified: data.status === true, reference_id: data.reference_id ?? null };
    logger.warn('Prembly BVN: production call not yet activated');
    return { success: false, verified: false, reference_id: null, error: 'Provider not configured' };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.error('Prembly BVN call failed', { error });
    return { success: false, verified: false, reference_id: null, error };
  }
}

// ---------------------------------------------------------------------------
// Tier 2 — NIN verification
// ---------------------------------------------------------------------------

export async function verifyNin(nin: string): Promise<PremblyResult> {
  const cfg = config();

  if (!cfg.isProduction) {
    logger.info('[PREMBLY STUB] NIN verification → verified=true', {
      nin: `${nin.slice(0, 3)}****${nin.slice(-2)}`,
    });
    return { success: true, verified: true, reference_id: `stub-nin-${Date.now()}` };
  }

  try {
    // const res = await fetch(`${cfg.premblyApiBaseUrl}/api/v2/biometrics/merchant/data/verification/nin_wo_face`, {
    //   method: 'POST',
    //   headers: {
    //     'Content-Type': 'application/json',
    //     'app-id': cfg.premblyApiKey,
    //     'x-api-key': cfg.premblyApiKey,
    //   },
    //   body: JSON.stringify({ number: nin }),
    //   signal: AbortSignal.timeout(cfg.premblyTimeoutMs),
    // });
    // const data = await res.json() as { status: boolean; reference_id?: string };
    // return { success: true, verified: data.status === true, reference_id: data.reference_id ?? null };
    logger.warn('Prembly NIN: production call not yet activated');
    return { success: false, verified: false, reference_id: null, error: 'Provider not configured' };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.error('Prembly NIN call failed', { error });
    return { success: false, verified: false, reference_id: null, error };
  }
}

// ---------------------------------------------------------------------------
// Tier 3 — Address verification
// ---------------------------------------------------------------------------

export async function verifyAddress(
  _addressLine: string, // eslint-disable-line @typescript-eslint/no-unused-vars
  utilityBillReference: string,
): Promise<PremblyResult> {
  const cfg = config();

  if (!cfg.isProduction) {
    logger.info('[PREMBLY STUB] Address verification → verified=true', { utilityBillReference });
    return { success: true, verified: true, reference_id: `stub-addr-${Date.now()}` };
  }

  try {
    // const res = await fetch(`${cfg.premblyApiBaseUrl}/api/v2/biometrics/merchant/data/verification/address`, {
    //   method: 'POST',
    //   headers: {
    //     'Content-Type': 'application/json',
    //     'app-id': cfg.premblyApiKey,
    //     'x-api-key': cfg.premblyApiKey,
    //   },
    //   body: JSON.stringify({ address: addressLine, utility_bill: utilityBillReference }),
    //   signal: AbortSignal.timeout(cfg.premblyTimeoutMs),
    // });
    // const data = await res.json() as { status: boolean; reference_id?: string };
    // return { success: true, verified: data.status === true, reference_id: data.reference_id ?? null };
    logger.warn('Prembly Address: production call not yet activated');
    return {
      success: false,
      verified: false,
      reference_id: null,
      error: 'Provider not configured',
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.error('Prembly Address call failed', { error });
    return { success: false, verified: false, reference_id: null, error };
  }
}
