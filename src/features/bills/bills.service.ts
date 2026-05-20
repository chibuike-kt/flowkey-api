import * as crypto from 'crypto';
import { prisma } from '../../common/utils/prisma';
import { AppError, ErrorCode } from '../../common/errors/AppError';
import { logger } from '../../common/utils/logger';
import { TIER_LIMITS, type KycTier } from '../kyc/kyc.types';
import {
  generateVtpassRequestId,
  getVariations,
  verifyCustomer,
  purchaseService,
  requeryTransaction,
} from './vtpass.provider';
import { sendPushNotification } from '../notifications/notification.service';
import { billReconcileQueue } from '../../queues';
import type {
  BillRecord,
  BillCategory,
  BillRecipient,
  DataPlan,
  TvPlan,
  VtpassVariation,
} from './bills.types';
import { VTPASS_SERVICE_IDS } from './bills.types';
import type {
  BuyAirtimeInput,
  BuyDataInput,
  PayTvInput,
  VerifySmartcardInput,
  VerifyMeterInput,
  PayElectricityInput,
  PayEducationInput,
  ListBillsInput,
} from './bills.schema';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

// Reconciliation retry schedule — delays in milliseconds
const RECONCILE_DELAYS_MS = [
  60_000, //  1 min
  300_000, //  5 min
  900_000, // 15 min
  1_800_000, // 30 min
  3_600_000, //  1 hr
  21_600_000, //  6 hr
];

// ---------------------------------------------------------------------------
// Provider response helpers — imported from bills.utils (no DB dependencies)
// ---------------------------------------------------------------------------

import {
  serializeProviderResponse,
  isMalformedProviderResponse,
  vtpassIsDelivered,
  vtpassIsPending,
  vtpassOrderId,
} from './bills.utils';

// ---------------------------------------------------------------------------
// Reference + number helpers
// ---------------------------------------------------------------------------

function billReference(): string {
  const d = new Date();
  const date = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const hex = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `BILL-${date}-${hex}`;
}

function transactionNumber(reference: string): string {
  const parts = reference.split('-');
  return `TXN-${parts[parts.length - 1] ?? reference}`;
}

// ---------------------------------------------------------------------------
// Wallet helpers — materialized balance
// ---------------------------------------------------------------------------

/**
 * Atomically debit the wallet.
 * Uses UPDATE ... WHERE available_balance >= amount to prevent overdraft.
 * Returns false if balance is insufficient — never throws.
 */
async function atomicDebit(walletId: string, amountKobo: bigint): Promise<boolean> {
  const result = (await db.$executeRaw`
    UPDATE wallets
    SET available_balance = available_balance - ${amountKobo},
        updated_at        = NOW()
    WHERE id = ${walletId}::uuid
      AND available_balance >= ${amountKobo}
  `) as number;
  return result > 0;
}

/**
 * Credit wallet — used for refunds and deposits.
 */
async function atomicCredit(tx: typeof db, walletId: string, amountKobo: bigint): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  await tx.$executeRaw`
    UPDATE wallets
    SET available_balance = available_balance + ${amountKobo},
        updated_at        = NOW()
    WHERE id = ${walletId}::uuid
  `;
}

// ---------------------------------------------------------------------------
// Idempotent refund
// ---------------------------------------------------------------------------

async function safeRefundWallet(
  walletId: string,
  amountKobo: bigint,
  billId: string,
  reference: string,
): Promise<void> {
  // Check for existing refund ledger entry — prevent double-refund
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const existing = await db.ledgerEntry.findFirst({
    where: {
      bill_id: billId,
      type: 'credit',
      reference: `REFUND-${reference}`,
    },
    select: { id: true },
  });

  if (existing) {
    logger.warn('bill_refund_skipped_already_exists', { bill_id: billId, reference });
    return;
  }

  // Refund: credit ledger + restore wallet balance — in one transaction
  await db.$transaction(async (tx: typeof db) => {
    await atomicCredit(tx, walletId, amountKobo);

    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    await tx.ledgerEntry.create({
      data: {
        wallet_id: walletId,
        transaction_id: null,
        bill_id: billId,
        type: 'credit',
        amount: amountKobo,
        reference: `REFUND-${reference}`,
      },
    });

    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    await tx.billTransaction.update({
      where: { id: billId },
      data: { status: 'refunded', completed_at: new Date() },
    });
  });

  logger.info('bill_refunded', { bill_id: billId, amount_kobo: amountKobo.toString() });
}

// ---------------------------------------------------------------------------
// Reconciliation queue helpers
// ---------------------------------------------------------------------------

async function enqueueReconcile(
  billId: string,
  walletId: string,
  amountKobo: bigint,
  reference: string,
  attempt: number,
): Promise<void> {
  const delayMs =
    RECONCILE_DELAYS_MS[attempt - 1] ?? RECONCILE_DELAYS_MS[RECONCILE_DELAYS_MS.length - 1]!;
  await billReconcileQueue.add(
    'reconcile-bill',
    { billId, walletId, amountKobo: amountKobo.toString(), reference, attemptNumber: attempt },
    {
      delay: delayMs,
      attempts: 1,
      jobId: `reconcile_${billId}_attempt_${attempt}`,
    },
  );
  logger.info('bill_reconcile_enqueued', { bill_id: billId, attempt, delay_ms: delayMs });
}

// ---------------------------------------------------------------------------
// Centralized bill finalization helpers
// ---------------------------------------------------------------------------

async function finalizeBillSuccess(
  billId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vtpassResult: any,
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  await db.billTransaction.update({
    where: { id: billId },
    data: {
      status: 'delivered',
      vtpass_order_id: vtpassOrderId(vtpassResult),
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      purchased_code: (vtpassResult?.purchased_code ?? vtpassResult?.token ?? null) as
        | string
        | null,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      units: (vtpassResult?.units ?? null) as string | null,
      provider_response: serializeProviderResponse(vtpassResult),
      completed_at: new Date(),
    },
  });
  logger.info('bill_delivered', { bill_id: billId });
}

async function finalizeBillPending(
  billId: string,
  walletId: string,
  amountKobo: bigint,
  reference: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vtpassResult: any,
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  await db.billTransaction.update({
    where: { id: billId },
    data: {
      status: 'pending',
      vtpass_order_id: vtpassOrderId(vtpassResult),
      provider_response: serializeProviderResponse(vtpassResult),
    },
  });
  await enqueueReconcile(billId, walletId, amountKobo, reference, 1);
  logger.info('bill_pending', { bill_id: billId });
}

async function finalizeBillRefunded(
  billId: string,
  walletId: string,
  amountKobo: bigint,
  reference: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vtpassResult: any,
): Promise<void> {
  // Persist provider response before refunding
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  await db.billTransaction.update({
    where: { id: billId },
    data: {
      status: 'failed',
      provider_response: serializeProviderResponse(vtpassResult),
    },
  });
  await safeRefundWallet(walletId, amountKobo, billId, reference);
  logger.info('bill_failed_and_refunded', { bill_id: billId });
}

async function finalizeBillUncertain(
  billId: string,
  walletId: string,
  amountKobo: bigint,
  reference: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vtpassResult: any,
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  await db.billTransaction.update({
    where: { id: billId },
    data: {
      status: 'provider_uncertain',
      provider_response: serializeProviderResponse(vtpassResult),
    },
  });
  // Requery — do NOT refund yet (provider may have processed)
  await enqueueReconcile(billId, walletId, amountKobo, reference, 1);
  logger.warn('bill_provider_uncertain', {
    bill_id: billId,
    response: serializeProviderResponse(vtpassResult).slice(0, 200),
  });
}

// ---------------------------------------------------------------------------
// Core purchase orchestrator — shared by all 5 categories
// ---------------------------------------------------------------------------

interface PurchaseContext {
  userId: string;
  walletId: string;
  kycTier: KycTier;
  category: BillCategory;
  serviceId: string;
  reference: string;
  requestId: string;
  amountKobo: bigint;
  narration: string;
  recipient: BillRecipient;
  idempotencyKey?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type VtpassPayload = Parameters<typeof purchaseService>[0];

async function executePurchase(
  ctx: PurchaseContext,
  vtpassPayload: VtpassPayload,
  limitType: 'airtime_kobo' | 'other_bills_kobo',
): Promise<BillRecord> {
  const {
    userId,
    walletId,
    kycTier,
    category,
    serviceId,
    reference,
    requestId,
    amountKobo,
    narration,
    recipient,
    idempotencyKey,
  } = ctx;

  // ── 1. Idempotency check ──────────────────────────────────────────────────
  if (idempotencyKey) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const existing = (await db.billTransaction.findFirst({
      where: { user_id: userId, idempotency_key: idempotencyKey },
    })) as BillRow | null;
    if (existing) {
      logger.info('bill_idempotent_hit', { bill_id: existing.id, idempotency_key: idempotencyKey });
      return rowToRecord(existing);
    }
  }

  // ── 2. KYC daily limit check ──────────────────────────────────────────────
  await checkDailyLimit(walletId, amountKobo, kycTier, limitType);

  // ── 3. Atomic wallet debit ────────────────────────────────────────────────
  const debited = await atomicDebit(walletId, amountKobo);
  if (!debited) {
    throw new AppError(ErrorCode.CONFLICT, 'Insufficient balance.');
  }

  // ── 4. Create bill record (wallet already debited) ────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const bill = (await db.billTransaction.create({
    data: {
      user_id: userId,
      wallet_id: walletId,
      category,
      service_id: serviceId,
      reference,
      vtpass_request_id: requestId,
      idempotency_key: idempotencyKey ?? null,
      status: 'processing',
      amount: amountKobo,
      fee: BigInt(0),
      narration,
      recipient,
    },
  })) as { id: string };

  // Append debit ledger entry (audit trail — NOT used for balance decisions)
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  await db.ledgerEntry.create({
    data: {
      wallet_id: walletId,
      transaction_id: null,
      bill_id: bill.id,
      type: 'debit',
      amount: amountKobo,
      reference,
    },
  });

  logger.info('bill_processing_started', {
    bill_id: bill.id,
    category,
    service: serviceId,
    amount: amountKobo.toString(),
  });

  // ── 5. Call VTPass (outside DB transaction) ───────────────────────────────
  let vtpassResult: unknown;
  let providerCallFailed = false;

  try {
    vtpassResult = await purchaseService(vtpassPayload);
    logger.info('provider_response_received', {
      bill_id: bill.id,
      raw: serializeProviderResponse(vtpassResult).slice(0, 300),
    });
  } catch (err) {
    // Network error or circuit breaker open — uncertain whether provider processed
    providerCallFailed = true;
    vtpassResult = { _error: err instanceof Error ? err.message : String(err) };
    logger.error('provider_call_failed', {
      bill_id: bill.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // ── 6. Finalize bill state ────────────────────────────────────────────────

  // Hard network failure — uncertain (do NOT refund, provider may have processed)
  if (providerCallFailed || isMalformedProviderResponse(vtpassResult)) {
    await finalizeBillUncertain(bill.id, walletId, amountKobo, reference, vtpassResult);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const row = (await db.billTransaction.findUnique({ where: { id: bill.id } })) as BillRow;
    return rowToRecord(row);
  }

  if (vtpassIsDelivered(vtpassResult)) {
    await finalizeBillSuccess(bill.id, vtpassResult);
    void notifyBillDelivered(userId, category, amountKobo, bill.id, vtpassResult);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const row = (await db.billTransaction.findUnique({ where: { id: bill.id } })) as BillRow;
    return rowToRecord(row);
  }

  if (vtpassIsPending(vtpassResult)) {
    await finalizeBillPending(bill.id, walletId, amountKobo, reference, vtpassResult);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const row = (await db.billTransaction.findUnique({ where: { id: bill.id } })) as BillRow;
    return rowToRecord(row);
  }

  // Provider confirmed failure — refund and throw
  await finalizeBillRefunded(bill.id, walletId, amountKobo, reference, vtpassResult);
  throw new AppError(
    ErrorCode.EXTERNAL_SERVICE_ERROR,
    'Bill payment failed. Your wallet has been refunded.',
  );
}

// ---------------------------------------------------------------------------
// Push notification by category (fire-and-forget)
// ---------------------------------------------------------------------------

async function notifyBillDelivered(
  userId: string,
  category: BillCategory,
  amountKobo: bigint,
  billId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vtpassResult: any,
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const session = (await db.deviceSession.findFirst({
    where: { user_id: userId, is_revoked: false },
    orderBy: { last_active: 'desc' },
    select: { fcm_token: true },
  })) as { fcm_token: string | null } | null;
  const fcm = session?.fcm_token;
  if (!fcm) return;

  const naira = (Number(amountKobo) / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 });

  const messages: Record<BillCategory, { title: string; body: string }> = {
    airtime: { title: 'Airtime Purchased', body: `₦${naira} airtime sent successfully` },
    data: { title: 'Data Purchased', body: `₦${naira} data bundle activated` },
    tv: { title: 'TV Subscription Renewed', body: `₦${naira} TV subscription renewed` },
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    electricity: {
      title: 'Electricity Payment Successful',
      body: `₦${naira} electricity paid${vtpassResult?.token ? `. Token: ${vtpassResult.token as string}` : ''}`,
    },
    education: { title: 'Education Payment Successful', body: `₦${naira} education pin purchased` },
  };

  const msg = messages[category] ?? { title: 'Bill Paid', body: `₦${naira} bill paid` };
  void sendPushNotification(fcm, msg.title, msg.body, {
    type: `bill_${category}`,
    bill_id: billId,
  });
}

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

async function resolveWallet(userId: string): Promise<{ walletId: string; kycTier: KycTier }> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const user = (await db.user.findUnique({
    where: { id: userId },
    select: { kyc_tier: true, wallet: { select: { id: true } } },
  })) as { kyc_tier: number; wallet: { id: string } | null } | null;
  if (!user?.wallet) throw new AppError(ErrorCode.NOT_FOUND, 'Wallet not found.');
  return { walletId: user.wallet.id, kycTier: (user.kyc_tier < 1 ? 1 : user.kyc_tier) as KycTier };
}

async function validatePin(userId: string, pin: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const auth = (await db.userAuth.findUnique({
    where: { user_id: userId },
    select: {
      transaction_pin_hash: true,
      transaction_pin_locked_until: true,
      transaction_pin_hard_locked: true,
    },
  })) as {
    transaction_pin_hash: string | null;
    transaction_pin_locked_until: Date | null;
    transaction_pin_hard_locked: boolean;
  } | null;

  if (!auth?.transaction_pin_hash)
    throw new AppError(
      ErrorCode.CONFLICT,
      'Transaction PIN not set. Please set your PIN in Settings.',
    );
  if (auth.transaction_pin_hard_locked)
    throw new AppError(ErrorCode.FORBIDDEN, 'Your transaction PIN is locked. Please reset it.');
  if (auth.transaction_pin_locked_until && auth.transaction_pin_locked_until > new Date())
    throw new AppError(ErrorCode.FORBIDDEN, 'Too many wrong PIN attempts. Please try again later.');

  const argon2 = await import('argon2');
  const valid = await argon2.verify(auth.transaction_pin_hash, pin);
  if (!valid) throw new AppError(ErrorCode.INVALID_CREDENTIALS, 'Incorrect transaction PIN.');
}

async function checkDailyLimit(
  walletId: string,
  amountKobo: bigint,
  kycTier: KycTier,
  limitType: 'airtime_kobo' | 'other_bills_kobo',
): Promise<void> {
  const limit = BigInt(TIER_LIMITS[kycTier][limitType]);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const agg = (await db.billTransaction.aggregate({
    where: {
      wallet_id: walletId,
      status: { in: ['delivered', 'pending', 'processing', 'provider_uncertain'] },
      created_at: { gte: today },
    },
    _sum: { amount: true },
  })) as { _sum: { amount: bigint | null } };

  const used = agg._sum.amount ?? BigInt(0);
  if (used + amountKobo > limit) {
    const limitNaira = Number(limit) / 100;
    throw new AppError(
      ErrorCode.CONFLICT,
      `Daily ${limitType === 'airtime_kobo' ? 'airtime' : 'bills'} limit of ₦${limitNaira.toLocaleString()} reached.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Public — GET /bills/data/plans
// ---------------------------------------------------------------------------

export async function getDataPlans(network: string): Promise<DataPlan[]> {
  const variations = await getVariations(`${network}-data`);
  return variations.map((v: VtpassVariation) => ({
    code: v.variation_code,
    name: v.name,
    amount: parseFloat(v.variation_amount),
  }));
}

// ---------------------------------------------------------------------------
// Public — GET /bills/tv/plans
// ---------------------------------------------------------------------------

export async function getTvPlans(provider: string): Promise<TvPlan[]> {
  const variations = await getVariations(provider);
  return variations.map((v: VtpassVariation) => ({
    code: v.variation_code,
    name: v.name,
    amount: parseFloat(v.variation_amount),
  }));
}

// ---------------------------------------------------------------------------
// Public — POST /bills/tv/verify
// ---------------------------------------------------------------------------

export async function verifySmartcard(input: VerifySmartcardInput): Promise<{
  customer_name: string;
  current_bouquet: string;
  renewal_amount: number;
  due_date: string;
}> {
  const serviceId = VTPASS_SERVICE_IDS[input.provider] ?? input.provider;
  const result = await verifyCustomer({ serviceID: serviceId, billersCode: input.smartcard });
  if (result.code !== '000')
    throw new AppError(
      ErrorCode.VALIDATION_ERROR,
      `Could not verify smartcard: ${result.response_description}`,
    );
  return {
    customer_name: result.content.customerName ?? result.content.Customer_Name ?? 'Unknown',
    current_bouquet: result.content.Current_Bouquet ?? '',
    renewal_amount: parseFloat(result.content.Amount ?? '0'),
    due_date: result.content.Due_Date ?? '',
  };
}

// ---------------------------------------------------------------------------
// Public — POST /bills/electricity/verify
// ---------------------------------------------------------------------------

export async function verifyMeter(input: VerifyMeterInput): Promise<{
  customer_name: string;
  customer_address: string;
  meter_type: string;
}> {
  const serviceId = VTPASS_SERVICE_IDS[input.disco] ?? input.disco;
  const result = await verifyCustomer({
    serviceID: serviceId,
    billersCode: input.meter_number,
    type: input.meter_type,
  });
  if (result.code !== '000')
    throw new AppError(
      ErrorCode.VALIDATION_ERROR,
      `Could not verify meter: ${result.response_description}`,
    );
  return {
    customer_name: result.content.Customer_Name ?? result.content.customerName ?? 'Unknown',
    customer_address: result.content.Customer_District ?? '',
    meter_type: result.content.Customer_Type ?? input.meter_type,
  };
}

// ---------------------------------------------------------------------------
// Public — POST /bills/airtime
// ---------------------------------------------------------------------------

export async function buyAirtime(
  userId: string,
  input: BuyAirtimeInput,
  idempotencyKey?: string,
): Promise<BillRecord> {
  await validatePin(userId, input.pin);
  const { walletId, kycTier } = await resolveWallet(userId);
  const serviceId = VTPASS_SERVICE_IDS[input.network] ?? input.network;
  const reference = billReference();
  const requestId = generateVtpassRequestId();

  return executePurchase(
    {
      userId,
      walletId,
      kycTier,
      category: 'airtime',
      serviceId,
      reference,
      requestId,
      amountKobo: BigInt(input.amount_kobo),
      narration: `${input.network.toUpperCase()} airtime top-up for ${input.phone}`,
      recipient: { phone: input.phone, network: input.network },
      idempotencyKey,
    },
    {
      request_id: requestId,
      serviceID: serviceId,
      amount: input.amount_kobo / 100,
      phone: input.phone,
    },
    'airtime_kobo',
  );
}

// ---------------------------------------------------------------------------
// Public — POST /bills/data
// ---------------------------------------------------------------------------

export async function buyData(
  userId: string,
  input: BuyDataInput,
  idempotencyKey?: string,
): Promise<BillRecord> {
  await validatePin(userId, input.pin);
  const { walletId, kycTier } = await resolveWallet(userId);
  const serviceId = VTPASS_SERVICE_IDS[`${input.network}-data`] ?? `${input.network}-data`;
  const reference = billReference();
  const requestId = generateVtpassRequestId();

  return executePurchase(
    {
      userId,
      walletId,
      kycTier,
      category: 'data',
      serviceId,
      reference,
      requestId,
      amountKobo: BigInt(input.amount_kobo),
      narration: `${input.network.toUpperCase()} data subscription for ${input.phone}`,
      recipient: { phone: input.phone, network: input.network, plan_name: input.variation_code },
      idempotencyKey,
    },
    {
      request_id: requestId,
      serviceID: serviceId,
      variation_code: input.variation_code,
      amount: input.amount_kobo / 100,
      phone: input.phone,
      billersCode: input.phone,
    },
    'other_bills_kobo',
  );
}

// ---------------------------------------------------------------------------
// Public — POST /bills/tv
// ---------------------------------------------------------------------------

export async function payTv(
  userId: string,
  input: PayTvInput,
  idempotencyKey?: string,
): Promise<BillRecord> {
  await validatePin(userId, input.pin);
  const { walletId, kycTier } = await resolveWallet(userId);
  const serviceId = VTPASS_SERVICE_IDS[input.provider] ?? input.provider;
  const reference = billReference();
  const requestId = generateVtpassRequestId();

  return executePurchase(
    {
      userId,
      walletId,
      kycTier,
      category: 'tv',
      serviceId,
      reference,
      requestId,
      amountKobo: BigInt(input.amount_kobo),
      narration: `${input.provider.toUpperCase()} subscription — ${input.variation_code}`,
      recipient: {
        smartcard: input.smartcard,
        provider: input.provider,
        bouquet: input.variation_code,
      },
      idempotencyKey,
    },
    {
      request_id: requestId,
      serviceID: serviceId,
      variation_code: input.variation_code,
      amount: input.amount_kobo / 100,
      phone: input.phone ?? '',
      billersCode: input.smartcard,
    },
    'other_bills_kobo',
  );
}

// ---------------------------------------------------------------------------
// Public — POST /bills/electricity
// ---------------------------------------------------------------------------

export async function payElectricity(
  userId: string,
  input: PayElectricityInput,
  idempotencyKey?: string,
): Promise<BillRecord> {
  await validatePin(userId, input.pin);
  const { walletId, kycTier } = await resolveWallet(userId);
  const serviceId = VTPASS_SERVICE_IDS[input.disco] ?? input.disco;
  const reference = billReference();
  const requestId = generateVtpassRequestId();

  return executePurchase(
    {
      userId,
      walletId,
      kycTier,
      category: 'electricity',
      serviceId,
      reference,
      requestId,
      amountKobo: BigInt(input.amount_kobo),
      narration: `${input.disco} electricity — meter ****${input.meter_number.slice(-4)}`,
      recipient: {
        meter_number: input.meter_number,
        meter_type: input.meter_type,
        disco: input.disco,
        customer_name: input.customer_name ?? undefined,
      },
      idempotencyKey,
    },
    {
      request_id: requestId,
      serviceID: serviceId,
      variation_code: input.meter_type,
      amount: input.amount_kobo / 100,
      phone: input.phone,
      billersCode: input.meter_number,
    },
    'other_bills_kobo',
  );
}

// ---------------------------------------------------------------------------
// Public — POST /bills/education
// ---------------------------------------------------------------------------

export async function payEducation(
  userId: string,
  input: PayEducationInput,
  idempotencyKey?: string,
): Promise<BillRecord> {
  await validatePin(userId, input.pin);
  const { walletId, kycTier } = await resolveWallet(userId);
  const serviceId = VTPASS_SERVICE_IDS[input.product] ?? input.product;
  const reference = billReference();
  const requestId = generateVtpassRequestId();

  return executePurchase(
    {
      userId,
      walletId,
      kycTier,
      category: 'education',
      serviceId,
      reference,
      requestId,
      amountKobo: BigInt(input.amount_kobo),
      narration: `${input.product.toUpperCase()} — qty ${input.quantity}`,
      recipient: { exam_type: input.product, quantity: input.quantity },
      idempotencyKey,
    },
    {
      request_id: requestId,
      serviceID: serviceId,
      amount: input.amount_kobo / 100,
      phone: input.phone,
      quantity: input.quantity,
    },
    'other_bills_kobo',
  );
}

// ---------------------------------------------------------------------------
// Public — GET /bills
// ---------------------------------------------------------------------------

export async function listBills(
  userId: string,
  input: ListBillsInput,
): Promise<{ items: BillRecord[]; next_cursor: string | null }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: Record<string, any> = { user_id: userId };
  if (input.category !== 'all') where['category'] = input.category;
  if (input.status) where['status'] = input.status;

  if (input.cursor) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const pivot = (await db.billTransaction.findUnique({
      where: { id: input.cursor },
      select: { created_at: true },
    })) as { created_at: Date } | null;
    if (pivot) where['created_at'] = { lt: pivot.created_at };
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const rows = (await db.billTransaction.findMany({
    where,
    orderBy: { created_at: 'desc' },
    take: input.limit + 1,
  })) as BillRow[];

  const items = rows.slice(0, input.limit).map((r) => rowToRecord(r));
  const nextCursor = rows.length > input.limit ? (items[items.length - 1]?.id ?? null) : null;
  return { items, next_cursor: nextCursor };
}

// ---------------------------------------------------------------------------
// Public — GET /bills/:id
// ---------------------------------------------------------------------------

export async function getBill(id: string, userId: string): Promise<BillRecord> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const row = (await db.billTransaction.findFirst({
    where: { id, user_id: userId },
  })) as BillRow | null;
  if (!row) throw new AppError(ErrorCode.NOT_FOUND, 'Bill transaction not found.');
  return rowToRecord(row);
}

// ---------------------------------------------------------------------------
// Public — POST /bills/:id/requery
// ---------------------------------------------------------------------------

export async function requeryBill(id: string, userId: string): Promise<BillRecord> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const row = (await db.billTransaction.findFirst({
    where: { id, user_id: userId },
  })) as BillRow | null;
  if (!row) throw new AppError(ErrorCode.NOT_FOUND, 'Bill transaction not found.');

  if (row.status === 'delivered' || row.status === 'refunded') return rowToRecord(row);

  const result = await requeryTransaction(row.vtpass_request_id);
  const delivered = vtpassIsDelivered(result);
  const failed = !delivered && !vtpassIsPending(result) && !isMalformedProviderResponse(result);

  if (delivered) {
    await finalizeBillSuccess(row.id, result);
  } else if (failed) {
    await finalizeBillRefunded(row.id, row.wallet_id, row.amount, row.reference, result);
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const updated = (await db.billTransaction.findUnique({ where: { id: row.id } })) as BillRow;
  return rowToRecord(updated);
}

// ---------------------------------------------------------------------------
// Exported for reconcile worker use
// ---------------------------------------------------------------------------

export {
  safeRefundWallet,
  finalizeBillSuccess,
  finalizeBillRefunded,
  finalizeBillUncertain,
  enqueueReconcile,
};

export {
  vtpassIsDelivered,
  vtpassIsPending,
  isMalformedProviderResponse,
  serializeProviderResponse,
} from './bills.utils';

// ---------------------------------------------------------------------------
// Internal types + mappers
// ---------------------------------------------------------------------------

interface BillRow {
  id: string;
  user_id: string;
  wallet_id: string;
  category: string;
  service_id: string;
  reference: string;
  vtpass_request_id: string;
  vtpass_order_id: string | null;
  status: string;
  amount: bigint;
  fee: bigint;
  narration: string;
  recipient: Record<string, unknown>;
  purchased_code: string | null;
  units: string | null;
  provider_response: string | null;
  created_at: Date;
  completed_at: Date | null;
}

function rowToRecord(r: BillRow): BillRecord {
  return {
    id: r.id,
    user_id: r.user_id,
    wallet_id: r.wallet_id,
    category: r.category as BillCategory,
    service_id: r.service_id,
    transaction_number: transactionNumber(r.reference),
    reference: r.reference,
    vtpass_request_id: r.vtpass_request_id,
    vtpass_order_id: r.vtpass_order_id,
    status: r.status as BillRecord['status'],
    amount_kobo: r.amount.toString(),
    fee_kobo: r.fee.toString(),
    narration: r.narration,
    recipient: r.recipient as BillRecipient,
    purchased_code: r.purchased_code,
    units: r.units,
    provider_response: r.provider_response,
    created_at: r.created_at,
    completed_at: r.completed_at,
  };
}
