import { logger } from '../../common/utils/logger';
import type { ProvidusVirtualAccountResponse, PaystackCardVerifyResponse } from './deposits.types';

const IS_PRODUCTION = process.env['NODE_ENV'] === 'production';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Providus — provision virtual account
// ---------------------------------------------------------------------------

export async function provisionVirtualAccount(params: {
  userId: string;
  accountName: string; // user's display name or registered name
}): Promise<ProvidusVirtualAccountResponse> {
  if (IS_PRODUCTION) {
    // TODO: Integrate Providus Virtual Account API
    // POST https://api.providusbank.com/pbn/merchant/virtual-account
    // Headers: ClientId, X-Auth-Signature (HMAC of request body)
    // Body: { account_name: params.accountName, bvn?: string }
    // Response: { account_number, account_name, ... }
    throw new Error('[DepositProcessor] Providus integration not yet configured.');
  }

  await delay(300);

  // Generate a deterministic-looking fake NUBAN based on userId
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

// ---------------------------------------------------------------------------
// Paystack — verify an authorization code is real and reusable
// ---------------------------------------------------------------------------

export async function verifyPaystackAuthorization(params: {
  authorization_code: string;
  last4: string;
  card_type: string;
  bank: string;
  expiry_month: string;
  expiry_year: string;
}): Promise<PaystackCardVerifyResponse> {
  if (IS_PRODUCTION) {
    // TODO: Paystack card verification
    // In production we'd verify by charging ₦50 and immediately refunding,
    // OR by calling GET /transaction/verify/:reference on the initial charge
    // reference from the SDK. The SDK provides the reference — pass it here.
    throw new Error('[DepositProcessor] Paystack card verification not yet configured.');
  }

  await delay(200);

  // Stub: accept any well-formed authorization code
  if (
    !params.authorization_code.startsWith('AUTH_') &&
    !params.authorization_code.startsWith('auth_')
  ) {
    return {
      success: false,
      last4: params.last4,
      card_type: params.card_type,
      bank: params.bank,
      expiry_month: params.expiry_month,
      expiry_year: params.expiry_year,
      reusable: false,
      authorization_code: params.authorization_code,
    };
  }

  logger.info('[PAYSTACK STUB] Card authorization verified', {
    last4: params.last4,
    card_type: params.card_type,
    bank: params.bank,
  });

  return {
    success: true,
    last4: params.last4,
    card_type: params.card_type.toLowerCase(),
    bank: params.bank,
    expiry_month: params.expiry_month,
    expiry_year: params.expiry_year,
    reusable: true,
    authorization_code: params.authorization_code,
  };
}

// ---------------------------------------------------------------------------
// Paystack — charge a saved authorization code
// ---------------------------------------------------------------------------

export async function chargePaystackCard(params: {
  authorization_code: string;
  amount_kobo: bigint;
  email: string; // required by Paystack
  reference: string; // our reference for this deposit
}): Promise<{ success: boolean; provider_ref: string; failure_reason?: string }> {
  if (IS_PRODUCTION) {
    // TODO: POST https://api.paystack.co/transaction/charge_authorization
    // { authorization_code, amount (in kobo), email, reference }
    // Response is async — Paystack POSTs to our webhook on completion.
    throw new Error('[DepositProcessor] Paystack charge not yet configured.');
  }

  // Simulate 2-4s processing
  await delay(2000 + Math.random() * 2000);

  const failRate = parseFloat(process.env['CARD_STUB_FAIL_RATE'] ?? '0');
  if (Math.random() < failRate) {
    logger.warn('[PAYSTACK STUB] Card charge failed (simulated)', {
      reference: params.reference,
    });
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
    amount_kobo: params.amount_kobo.toString(),
  });

  return { success: true, provider_ref: providerRef };
}
