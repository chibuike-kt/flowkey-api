import { config } from '../../config';
import { logger } from '../../common/utils/logger';
import { createBreaker, fire } from '../../common/resilience/circuit-breaker';
import type { PremblyResult } from './kyc.types';

// ---------------------------------------------------------------------------
// Circuit breakers — one per Prembly endpoint
// ---------------------------------------------------------------------------

const _bvnBreaker = createBreaker(async (bvn: string) => _callPremblyBvn(bvn), {
  name: 'prembly-bvn',
  timeout: 12_000,
  resetTimeout: 60_000,
});

const _ninBreaker = createBreaker(async (nin: string) => _callPremblyNin(nin), {
  name: 'prembly-nin',
  timeout: 12_000,
  resetTimeout: 60_000,
});

const _addressBreaker = createBreaker(
  async (addressLine: string, utilityBillReference: string) =>
    _callPremblyAddress(addressLine, utilityBillReference),
  { name: 'prembly-address', timeout: 12_000, resetTimeout: 60_000 },
);

// ---------------------------------------------------------------------------
// Public API
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
    return await fire(_bvnBreaker, bvn);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.error('Prembly BVN circuit breaker error', { error });
    return { success: false, verified: false, reference_id: null, error };
  }
}

export async function verifyNin(nin: string): Promise<PremblyResult> {
  const cfg = config();
  if (!cfg.isProduction) {
    logger.info('[PREMBLY STUB] NIN verification → verified=true', {
      nin: `${nin.slice(0, 3)}****${nin.slice(-2)}`,
    });
    return { success: true, verified: true, reference_id: `stub-nin-${Date.now()}` };
  }
  try {
    return await fire(_ninBreaker, nin);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.error('Prembly NIN circuit breaker error', { error });
    return { success: false, verified: false, reference_id: null, error };
  }
}

export async function verifyAddress(
  addressLine: string,
  utilityBillReference: string,
): Promise<PremblyResult> {
  const cfg = config();
  if (!cfg.isProduction) {
    logger.info('[PREMBLY STUB] Address verification → verified=true', { utilityBillReference });
    return { success: true, verified: true, reference_id: `stub-addr-${Date.now()}` };
  }
  try {
    return await fire(_addressBreaker, addressLine, utilityBillReference);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.error('Prembly Address circuit breaker error', { error });
    return { success: false, verified: false, reference_id: null, error };
  }
}

// ---------------------------------------------------------------------------
// Production implementations (activate when keys are set)
// ---------------------------------------------------------------------------

async function _callPremblyBvn(bvn: string): Promise<PremblyResult> {
  const cfg = config();
  // const res = await fetch(`${cfg.premblyApiBaseUrl}/api/v2/biometrics/merchant/data/verification/bvn`, {
  //   method: 'POST',
  //   headers: { 'Content-Type': 'application/json', 'app-id': cfg.premblyApiKey, 'x-api-key': cfg.premblyApiKey },
  //   body: JSON.stringify({ number: bvn }),
  //   signal: AbortSignal.timeout(10_000),
  // });
  // const data = await res.json() as { status: boolean; reference_id?: string };
  // return { success: true, verified: data.status === true, reference_id: data.reference_id ?? null };
  void bvn;
  void cfg;
  logger.warn('Prembly BVN: production call not yet activated');
  return { success: false, verified: false, reference_id: null, error: 'Provider not configured' };
}

async function _callPremblyNin(nin: string): Promise<PremblyResult> {
  const cfg = config();
  // const res = await fetch(`${cfg.premblyApiBaseUrl}/api/v2/biometrics/merchant/data/verification/nin_wo_face`, {
  //   method: 'POST',
  //   headers: { 'Content-Type': 'application/json', 'app-id': cfg.premblyApiKey, 'x-api-key': cfg.premblyApiKey },
  //   body: JSON.stringify({ number: nin }),
  //   signal: AbortSignal.timeout(10_000),
  // });
  // const data = await res.json() as { status: boolean; reference_id?: string };
  // return { success: true, verified: data.status === true, reference_id: data.reference_id ?? null };
  void nin;
  void cfg;
  logger.warn('Prembly NIN: production call not yet activated');
  return { success: false, verified: false, reference_id: null, error: 'Provider not configured' };
}

async function _callPremblyAddress(
  addressLine: string,
  utilityBillReference: string,
): Promise<PremblyResult> {
  const cfg = config();
  // const res = await fetch(`${cfg.premblyApiBaseUrl}/api/v2/biometrics/merchant/data/verification/address`, {
  //   method: 'POST',
  //   headers: { 'Content-Type': 'application/json', 'app-id': cfg.premblyApiKey, 'x-api-key': cfg.premblyApiKey },
  //   body: JSON.stringify({ address: addressLine, utility_bill: utilityBillReference }),
  //   signal: AbortSignal.timeout(10_000),
  // });
  // const data = await res.json() as { status: boolean; reference_id?: string };
  // return { success: true, verified: data.status === true, reference_id: data.reference_id ?? null };
  void addressLine;
  void utilityBillReference;
  void cfg;
  logger.warn('Prembly Address: production call not yet activated');
  return { success: false, verified: false, reference_id: null, error: 'Provider not configured' };
}
