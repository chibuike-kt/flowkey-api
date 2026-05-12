import * as crypto from 'crypto';
import { prisma } from '../../common/utils/prisma';
import { logger } from '../../common/utils/logger';
import { creditWallet } from '../deposits/deposits.service';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

const PROVIDUS_SECRET = process.env['PROVIDUS_WEBHOOK_SECRET'] ?? 'providus-dev-secret';
const PAYSTACK_SECRET = process.env['PAYSTACK_SECRET_KEY'] ?? 'paystack-dev-secret';

// ---------------------------------------------------------------------------
// HMAC verification helpers
// ---------------------------------------------------------------------------

export function verifyProvidusSignature(rawBody: string, signature: string): boolean {
  const expected = crypto.createHmac('sha512', PROVIDUS_SECRET).update(rawBody).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature, 'hex'));
  } catch {
    return false;
  }
}

export function verifyPaystackSignature(rawBody: string, signature: string): boolean {
  const expected = crypto.createHmac('sha512', PAYSTACK_SECRET).update(rawBody).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature, 'hex'));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Idempotency guard — record webhook, return true if already processed
// ---------------------------------------------------------------------------

async function recordWebhook(params: {
  provider: string;
  webhookId: string;
  eventType: string;
  payloadHash: string;
  hmacVerified: boolean;
}): Promise<boolean> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const existing = (await db.webhook.findUnique({
    where: {
      provider_webhook_id: {
        provider: params.provider,
        webhook_id: params.webhookId,
      },
    },
    select: { id: true, processing_status: true },
  })) as { id: string; processing_status: string } | null;

  if (existing) {
    logger.warn('Duplicate webhook received — already processed', {
      provider: params.provider,
      webhook_id: params.webhookId,
      status: existing.processing_status,
    });
    return true; // already handled
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  await db.webhook.create({
    data: {
      provider: params.provider,
      webhook_id: params.webhookId,
      event_type: params.eventType,
      hmac_verified: params.hmacVerified,
      processing_status: 'processing',
      payload_hash: params.payloadHash,
    },
  });

  return false;
}

async function markWebhookComplete(provider: string, webhookId: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  await db.webhook.update({
    where: { provider_webhook_id: { provider, webhook_id: webhookId } },
    data: { processing_status: 'completed' },
  });
}

async function markWebhookFailed(
  provider: string,
  webhookId: string,
  error: string,
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  await db.webhook.update({
    where: { provider_webhook_id: { provider, webhook_id: webhookId } },
    data: { processing_status: 'failed', error_message: error },
  });
}

// ---------------------------------------------------------------------------
// Providus virtual account credit webhook
// ---------------------------------------------------------------------------

export async function handleProvidusWebhook(rawBody: string, signature: string): Promise<void> {
  const hmacValid = verifyProvidusSignature(rawBody, signature);

  if (!hmacValid) {
    logger.warn('Providus webhook: HMAC verification failed');
    return; // don't throw — return 200 to prevent infinite retries
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let event: Record<string, any>;
  try {
    event = JSON.parse(rawBody) as Record<string, any>;
  } catch {
    logger.warn('Providus webhook: invalid JSON body');
    return;
  }

  const webhookId = (event['transaction_id'] as string | undefined) ?? `PRV-${Date.now()}`;
  const eventType = 'virtual_account.credit';
  const payloadHash = crypto.createHash('sha256').update(rawBody).digest('hex');

  const alreadyProcessed = await recordWebhook({
    provider: 'providus',
    webhookId,
    eventType,
    payloadHash,
    hmacVerified: true,
  });
  if (alreadyProcessed) return;

  try {
    // Providus payload shape (adapt to actual API response):
    // { transaction_id, account_number, amount, currency, narration, session_id }
    const accountNumber = event['account_number'] as string | undefined;
    const amountNaira = event['amount'] as number | undefined;
    const narration = event['narration'] as string | null | undefined;
    const sessionId = event['session_id'] as string | undefined;

    if (!accountNumber || !amountNaira) {
      logger.warn('Providus webhook: missing required fields', { event });
      await markWebhookFailed('providus', webhookId, 'Missing account_number or amount');
      return;
    }

    const amountKobo = BigInt(Math.round(amountNaira * 100));

    // Find wallet by virtual account number
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const virtualAccount = (await db.virtualAccount.findUnique({
      where: { account_number: accountNumber },
      select: { id: true, wallet_id: true, is_active: true },
    })) as { id: string; wallet_id: string; is_active: boolean } | null;

    if (!virtualAccount) {
      logger.warn('Providus webhook: virtual account not found', { accountNumber });
      await markWebhookFailed('providus', webhookId, `Virtual account not found: ${accountNumber}`);
      return;
    }

    if (!virtualAccount.is_active) {
      logger.warn('Providus webhook: virtual account is inactive', { accountNumber });
      await markWebhookFailed('providus', webhookId, 'Virtual account inactive');
      return;
    }

    // Create deposit record and credit wallet
    const reference = `PRV-${webhookId}`;

    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const deposit = (await db.deposit.create({
      data: {
        wallet_id: virtualAccount.wallet_id,
        channel: 'virtual_account',
        status: 'completed',
        amount: amountKobo,
        fee: BigInt(0),
        net_amount: amountKobo,
        reference,
        provider_ref: sessionId ?? webhookId,
        narration: narration ?? 'Bank transfer',
        completed_at: new Date(),
        idempotency_key: crypto.randomUUID(),
      },
    })) as { id: string };

    await creditWallet({
      walletId: virtualAccount.wallet_id,
      amountKobo,
      channel: 'virtual_account',
      reference,
      providerRef: sessionId ?? webhookId,
      narration: narration ?? 'Bank transfer',
      depositId: deposit.id,
    });

    await markWebhookComplete('providus', webhookId);

    logger.info('Providus virtual account credit processed', {
      wallet_id: virtualAccount.wallet_id,
      amount_kobo: amountKobo.toString(),
      reference,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Providus webhook processing error', { webhookId, error: message });
    await markWebhookFailed('providus', webhookId, message);
  }
}

// ---------------------------------------------------------------------------
// Paystack card charge webhook
// ---------------------------------------------------------------------------

export async function handlePaystackWebhook(rawBody: string, signature: string): Promise<void> {
  const hmacValid = verifyPaystackSignature(rawBody, signature);

  if (!hmacValid) {
    logger.warn('Paystack webhook: HMAC verification failed');
    return;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let event: Record<string, any>;
  try {
    event = JSON.parse(rawBody) as Record<string, any>;
  } catch {
    logger.warn('Paystack webhook: invalid JSON body');
    return;
  }

  const eventType = event['event'] as string | undefined;
  const data = event['data'] as Record<string, unknown> | undefined;
  const webhookId =
    (data?.['id'] as string | number | undefined)?.toString() ?? `PSK-${Date.now()}`;
  const payloadHash = crypto.createHash('sha256').update(rawBody).digest('hex');

  const alreadyProcessed = await recordWebhook({
    provider: 'paystack',
    webhookId,
    eventType: eventType ?? 'unknown',
    payloadHash,
    hmacVerified: true,
  });
  if (alreadyProcessed) return;

  try {
    if (eventType === 'charge.success') {
      await handlePaystackChargeSuccess(data ?? {}, webhookId);
    } else {
      // Other events (transfer.success, etc.) — log and acknowledge
      logger.info('Paystack webhook: unhandled event type', { eventType, webhookId });
    }

    await markWebhookComplete('paystack', webhookId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Paystack webhook processing error', { webhookId, eventType, error: message });
    await markWebhookFailed('paystack', webhookId, message);
  }
}

async function handlePaystackChargeSuccess(
  data: Record<string, unknown>,
  webhookId: string,
): Promise<void> {
  const reference = data['reference'] as string | undefined;
  const amountKobo = data['amount'] as number | undefined; // Paystack sends in kobo
  const providerRef = data['id'] as string | number | undefined;

  if (!reference || !amountKobo) {
    logger.warn('Paystack charge.success: missing reference or amount', { data });
    return;
  }

  // Find the deposit by reference
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const deposit = (await db.deposit.findFirst({
    where: { reference },
    select: { id: true, wallet_id: true, status: true, amount: true },
  })) as {
    id: string;
    wallet_id: string;
    status: string;
    amount: bigint;
  } | null;

  if (!deposit) {
    logger.warn('Paystack webhook: deposit not found for reference', { reference });
    return;
  }

  if (deposit.status === 'completed') {
    logger.info('Paystack webhook: deposit already completed', { reference });
    return;
  }

  await creditWallet({
    walletId: deposit.wallet_id,
    amountKobo: deposit.amount,
    channel: 'card',
    reference,
    providerRef: providerRef?.toString() ?? webhookId,
    narration: 'Card deposit',
    depositId: deposit.id,
  });

  logger.info('Paystack card charge credited', {
    deposit_id: deposit.id,
    wallet_id: deposit.wallet_id,
    amount_kobo: deposit.amount.toString(),
    reference,
  });
}
