import { logger } from '../../common/utils/logger';
import { createBreaker, fire } from '../../common/resilience/circuit-breaker';
import type { ProvidusVirtualAccountResponse, PaystackCardVerifyResponse } from './deposits.types';

const IS_PRODUCTION = process.env['NODE_ENV'] === 'production';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Circuit breakers — created once at module load (singletons)
// ---------------------------------------------------------------------------

const _providusBreaker = createBreaker(
  async (params: { userId: string; accountName: string }) => _callProvidus(params),
  { name: 'providus', timeout: 15_000, resetTimeout: 60_000 },
);

const _paystackVerifyBreaker = createBreaker(
  async (params: {
    authorization_code: string;
    last4: string;
    card_type: string;
    bank: string;
    expiry_month: string;
    expiry_year: string;
  }) => _callPaystackVerify(params),
  { name: 'paystack-verify', timeout: 10_000 },
);

const _paystackChargeBreaker = createBreaker(
  async (params: {
    authorization_code: string;
    amount_kobo: bigint;
    email: string;
    reference: string;
  }) => _callPaystackCharge(params),
  { name: 'paystack-charge', timeout: 15_000, resetTimeout: 60_000 },
);

// ---------------------------------------------------------------------------
// Public API — delegates to circuit breakers
// ---------------------------------------------------------------------------

export async function provisionVirtualAccount(params: {
  userId: string;
  accountName: string;
}): Promise<ProvidusVirtualAccountResponse> {
  if (!IS_PRODUCTION) return _providusStub(params);
  return fire(_providusBreaker, params);
}

export async function verifyPaystackAuthorization(params: {
  authorization_code: string;
  last4: string;
  card_type: string;
  bank: string;
  expiry_month: string;
  expiry_year: string;
}): Promise<PaystackCardVerifyResponse> {
  if (!IS_PRODUCTION) return _paystackVerifyStub(params);
  return fire(_paystackVerifyBreaker, params);
}

export async function chargePaystackCard(params: {
  authorization_code: string;
  amount_kobo: bigint;
  email: string;
  reference: string;
}): Promise<{ success: boolean; provider_ref: string; failure_reason?: string }> {
  if (!IS_PRODUCTION) return _paystackChargeStub(params);
  return fire(_paystackChargeBreaker, params);
}

// ---------------------------------------------------------------------------
// Production implementations (stubs until real API keys are configured)
// ---------------------------------------------------------------------------

async function _callProvidus(_params: {
  userId: string;
  accountName: string;
}): Promise<ProvidusVirtualAccountResponse> {
  // TODO: POST https://api.providusbank.com/pbn/merchant/virtual-account
  throw new Error('[Providus] Production integration not yet configured.');
}

async function _callPaystackVerify(_params: {
  authorization_code: string;
  last4: string;
  card_type: string;
  bank: string;
  expiry_month: string;
  expiry_year: string;
}): Promise<PaystackCardVerifyResponse> {
  // TODO: GET https://api.paystack.co/transaction/verify/:reference
  throw new Error('[Paystack] Production card verify not yet configured.');
}

async function _callPaystackCharge(_params: {
  authorization_code: string;
  amount_kobo: bigint;
  email: string;
  reference: string;
}): Promise<{ success: boolean; provider_ref: string; failure_reason?: string }> {
  // TODO: POST https://api.paystack.co/transaction/charge_authorization
  throw new Error('[Paystack] Production card charge not yet configured.');
}

// ---------------------------------------------------------------------------
// Dev / staging stubs
// ---------------------------------------------------------------------------

async function _providusStub(params: {
  userId: string;
  accountName: string;
}): Promise<ProvidusVirtualAccountResponse> {
  await delay(300);
  const seed = params.userId.replace(/-/g, '').slice(0, 10);
  const accountNumber = `9${seed.slice(0, 9)}`.padEnd(10, '0').slice(0, 10);
  logger.info('[PROVIDUS STUB] Virtual account provisioned', {
    user_id: params.userId,
    account_number: `****${accountNumber.slice(-4)}`,
  });
  return {
    success: true,
    account_number: accountNumber,
    account_name: params.accountName,
    bank_name: 'Providus Bank',
    bank_code: '101',
    provider_ref: `PRV-${Date.now()}`,
  };
}

async function _paystackVerifyStub(params: {
  authorization_code: string;
  last4: string;
  card_type: string;
  bank: string;
  expiry_month: string;
  expiry_year: string;
}): Promise<PaystackCardVerifyResponse> {
  await delay(200);
  const valid = params.authorization_code.toLowerCase().startsWith('auth_');
  if (!valid) {
    return {
      success: false,
      reusable: false,
      ...params,
      authorization_code: params.authorization_code,
    };
  }
  logger.info('[PAYSTACK STUB] Card authorization verified', {
    last4: params.last4,
    card_type: params.card_type,
    bank: params.bank,
  });
  return { success: true, reusable: true, ...params, card_type: params.card_type.toLowerCase() };
}

async function _paystackChargeStub(params: {
  authorization_code: string;
  amount_kobo: bigint;
  email: string;
  reference: string;
}): Promise<{ success: boolean; provider_ref: string; failure_reason?: string }> {
  await delay(2000 + Math.random() * 2000);
  const failRate = parseFloat(process.env['CARD_STUB_FAIL_RATE'] ?? '0');
  if (Math.random() < failRate) {
    logger.warn('[PAYSTACK STUB] Card charge failed (simulated)', { reference: params.reference });
    return {
      success: false,
      provider_ref: `PSK-FAIL-${Date.now()}`,
      failure_reason: 'Insufficient funds (simulated)',
    };
  }
  const providerRef = `PSK-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  logger.info('[PAYSTACK STUB] Card charge successful', {
    reference: params.reference,
    provider_ref: providerRef,
  });
  return { success: true, provider_ref: providerRef };
}
