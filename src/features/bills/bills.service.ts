/**
 * FlowKey — Bills Service
 *
 * Handles all bill payment categories via VTPass.
 *
 * Payment flow (all categories):
 *   1. Validate PIN
 *   2. Check KYC daily limit (airtime_kobo or other_bills_kobo)
 *   3. Debit wallet immediately (money leaves FlowKey first)
 *   4. Call VTPass (sync for airtime/data/education, async worker for TV/electricity)
 *   5. On VTPass success (code 000): mark delivered, push notification
 *   6. On VTPass pending (code 099): enqueue requery worker
 *   7. On VTPass failure: mark failed, auto-refund wallet
 */

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

// ---------------------------------------------------------------------------
// Helpers
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

async function resolveWallet(userId: string): Promise<{ walletId: string; kycTier: KycTier }> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const user = (await db.user.findUnique({
    where: { id: userId },
    select: {
      kyc_tier: true,
      wallet: { select: { id: true } },
    },
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
      transaction_pin_failed_attempts: true,
      transaction_pin_locked_until: true,
      transaction_pin_hard_locked: true,
    },
  })) as {
    transaction_pin_hash: string | null;
    transaction_pin_failed_attempts: number;
    transaction_pin_locked_until: Date | null;
    transaction_pin_hard_locked: boolean;
  } | null;

  if (!auth?.transaction_pin_hash) {
    throw new AppError(
      ErrorCode.CONFLICT,
      'Transaction PIN not set. Please set your PIN in Settings.',
    );
  }
  if (auth.transaction_pin_hard_locked) {
    throw new AppError(ErrorCode.FORBIDDEN, 'Your transaction PIN is locked. Please reset it.');
  }
  if (auth.transaction_pin_locked_until && auth.transaction_pin_locked_until > new Date()) {
    throw new AppError(ErrorCode.FORBIDDEN, 'Too many wrong PIN attempts. Please try again later.');
  }

  const argon2 = await import('argon2');
  const valid = await argon2.verify(auth.transaction_pin_hash, pin);
  if (!valid) throw new AppError(ErrorCode.INVALID_CREDENTIALS, 'Incorrect transaction PIN.');
}

async function getBalance(walletId: string): Promise<bigint> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const [credits, debits] = await db.$transaction([
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    db.ledgerEntry.aggregate({
      where: { wallet_id: walletId, type: 'credit' },
      _sum: { amount: true },
    }),
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    db.ledgerEntry.aggregate({
      where: { wallet_id: walletId, type: 'debit' },
      _sum: { amount: true },
    }),
  ]);
  const c = (credits as { _sum: { amount: bigint | null } })._sum.amount ?? BigInt(0);
  const d = (debits as { _sum: { amount: bigint | null } })._sum.amount ?? BigInt(0);
  return c - d;
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
  const todayBills = (await db.billTransaction.aggregate({
    where: {
      wallet_id: walletId,
      status: { in: ['delivered', 'pending', 'processing'] },
      created_at: { gte: today },
    },
    _sum: { amount: true },
  })) as { _sum: { amount: bigint | null } };

  const used = todayBills._sum.amount ?? BigInt(0);
  if (used + amountKobo > limit) {
    const limitNaira = Number(limit) / 100;
    throw new AppError(
      ErrorCode.CONFLICT,
      `Daily ${limitType === 'airtime_kobo' ? 'airtime' : 'bills'} limit of ₦${limitNaira.toLocaleString()} reached.`,
    );
  }
}

async function debitWallet(
  tx: typeof db,
  walletId: string,
  amountKobo: bigint,
  billId: string,
  reference: string,
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  await tx.ledgerEntry.create({
    data: {
      wallet_id: walletId,
      transaction_id: null,
      bill_id: billId,
      type: 'debit',
      amount: amountKobo,
      reference,
    },
  });
}

async function refundWallet(
  walletId: string,
  amountKobo: bigint,
  billId: string,
  reference: string,
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  await db.ledgerEntry.create({
    data: {
      wallet_id: walletId,
      transaction_id: null,
      bill_id: billId,
      type: 'credit',
      amount: amountKobo,
      reference: `REFUND-${reference}`,
    },
  });
  logger.info('Bill payment refunded', { bill_id: billId, amount_kobo: amountKobo.toString() });
}

async function getUserFcmToken(userId: string): Promise<string | null> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const session = (await db.deviceSession.findFirst({
    where: { user_id: userId, is_revoked: false },
    orderBy: { last_active: 'desc' },
    select: { fcm_token: true },
  })) as { fcm_token: string | null } | null;
  return session?.fcm_token ?? null;
}

// ---------------------------------------------------------------------------
// GET /bills/data/plans — list data bundles
// ---------------------------------------------------------------------------

export async function getDataPlans(network: string): Promise<DataPlan[]> {
  const serviceId = `${network}-data`;
  const variations = await getVariations(serviceId);
  return variations.map((v: VtpassVariation) => ({
    code: v.variation_code,
    name: v.name,
    amount: parseFloat(v.variation_amount),
  }));
}

// ---------------------------------------------------------------------------
// GET /bills/tv/plans — list TV bouquets
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
// GET /bills/electricity/discos — static list
// ---------------------------------------------------------------------------

export { DISCO_LIST } from './bills.types';

// ---------------------------------------------------------------------------
// POST /bills/tv/verify — verify smartcard
// ---------------------------------------------------------------------------

export async function verifySmartcard(input: VerifySmartcardInput): Promise<{
  customer_name: string;
  current_bouquet: string;
  renewal_amount: number;
  due_date: string;
}> {
  const serviceId = VTPASS_SERVICE_IDS[input.provider] ?? input.provider;
  const result = await verifyCustomer({
    serviceID: serviceId,
    billersCode: input.smartcard,
  });

  if (result.code !== '000') {
    throw new AppError(
      ErrorCode.VALIDATION_ERROR,
      `Could not verify smartcard: ${result.response_description}`,
    );
  }

  return {
    customer_name: result.content.customerName ?? result.content.Customer_Name ?? 'Unknown',
    current_bouquet: result.content.Current_Bouquet ?? '',
    renewal_amount: parseFloat(result.content.Amount ?? '0'),
    due_date: result.content.Due_Date ?? '',
  };
}

// ---------------------------------------------------------------------------
// POST /bills/electricity/verify — verify meter number
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

  if (result.code !== '000') {
    throw new AppError(
      ErrorCode.VALIDATION_ERROR,
      `Could not verify meter: ${result.response_description}`,
    );
  }

  return {
    customer_name: result.content.Customer_Name ?? result.content.customerName ?? 'Unknown',
    customer_address: result.content.Customer_District ?? '',
    meter_type: result.content.Customer_Type ?? input.meter_type,
  };
}

// ---------------------------------------------------------------------------
// POST /bills/airtime
// ---------------------------------------------------------------------------

export async function buyAirtime(userId: string, input: BuyAirtimeInput): Promise<BillRecord> {
  await validatePin(userId, input.pin);
  const { walletId, kycTier } = await resolveWallet(userId);
  const amountKobo = BigInt(input.amount_kobo);

  const balance = await getBalance(walletId);
  if (balance < amountKobo) throw new AppError(ErrorCode.CONFLICT, 'Insufficient balance.');

  await checkDailyLimit(walletId, amountKobo, kycTier, 'airtime_kobo');

  const reference = billReference();
  const requestId = generateVtpassRequestId();
  const serviceId = VTPASS_SERVICE_IDS[input.network] ?? input.network;

  const bill = await db.$transaction(
    async (tx: typeof db) => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      const row = (await tx.billTransaction.create({
        data: {
          user_id: userId,
          wallet_id: walletId,
          category: 'airtime',
          service_id: serviceId,
          reference,
          vtpass_request_id: requestId,
          status: 'processing',
          amount: amountKobo,
          fee: BigInt(0),
          narration: `${input.network.toUpperCase()} airtime top-up for ${input.phone}`,
          recipient: { phone: input.phone, network: input.network },
        },
      })) as { id: string };

      await debitWallet(tx, walletId, amountKobo, row.id, reference);
      return row;
    },
    { isolationLevel: 'Serializable' },
  );

  // Call VTPass synchronously — airtime is near-instant
  let vtpassResult;
  try {
    vtpassResult = await purchaseService({
      request_id: requestId,
      serviceID: serviceId,
      amount: input.amount_kobo / 100, // VTPass uses naira
      phone: input.phone,
    });
  } catch (err) {
    // VTPass call failed — refund
    await refundWallet(walletId, amountKobo, bill.id, reference);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    await db.billTransaction.update({ where: { id: bill.id }, data: { status: 'failed' } });
    throw new AppError(
      ErrorCode.EXTERNAL_SERVICE_ERROR,
      'Airtime service temporarily unavailable. Your wallet has been refunded.',
    );
  }

  const delivered =
    vtpassResult.code === '000' && vtpassResult.content.transactions.status === 'delivered';
  const pending =
    vtpassResult.code === '099' || vtpassResult.content.transactions.status === 'pending';
  const status = delivered ? 'delivered' : pending ? 'pending' : 'failed';

  if (status === 'failed') {
    await refundWallet(walletId, amountKobo, bill.id, reference);
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  await db.billTransaction.update({
    where: { id: bill.id },
    data: {
      status,
      vtpass_order_id: vtpassResult.content.transactions.transactionId,
      completed_at: delivered ? new Date() : null,
    },
  });

  if (delivered) {
    const fcm = await getUserFcmToken(userId);
    if (fcm) {
      const naira = (input.amount_kobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 });
      void sendPushNotification(
        fcm,
        'Airtime Purchased',
        `₦${naira} ${input.network.toUpperCase()} airtime sent to ${input.phone}`,
        { type: 'bill_airtime', bill_id: bill.id },
      );
    }
  }

  logger.info('Airtime purchase completed', {
    bill_id: bill.id,
    status,
    network: input.network,
    amount_kobo: amountKobo.toString(),
  });

  return toBillRecord(
    bill.id,
    userId,
    walletId,
    'airtime',
    serviceId,
    reference,
    requestId,
    status,
    amountKobo,
    { phone: input.phone, network: input.network },
    vtpassResult,
  );
}

// ---------------------------------------------------------------------------
// POST /bills/data
// ---------------------------------------------------------------------------

export async function buyData(userId: string, input: BuyDataInput): Promise<BillRecord> {
  await validatePin(userId, input.pin);
  const { walletId, kycTier } = await resolveWallet(userId);
  const amountKobo = BigInt(input.amount_kobo);

  const balance = await getBalance(walletId);
  if (balance < amountKobo) throw new AppError(ErrorCode.CONFLICT, 'Insufficient balance.');

  await checkDailyLimit(walletId, amountKobo, kycTier, 'other_bills_kobo');

  const reference = billReference();
  const requestId = generateVtpassRequestId();
  const serviceId = VTPASS_SERVICE_IDS[`${input.network}-data`] ?? `${input.network}-data`;

  const bill = await db.$transaction(
    async (tx: typeof db) => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      const row = (await tx.billTransaction.create({
        data: {
          user_id: userId,
          wallet_id: walletId,
          category: 'data',
          service_id: serviceId,
          reference,
          vtpass_request_id: requestId,
          status: 'processing',
          amount: amountKobo,
          fee: BigInt(0),
          narration: `${input.network.toUpperCase()} data subscription for ${input.phone}`,
          recipient: {
            phone: input.phone,
            network: input.network,
            plan_name: input.variation_code,
          },
        },
      })) as { id: string };
      await debitWallet(tx, walletId, amountKobo, row.id, reference);
      return row;
    },
    { isolationLevel: 'Serializable' },
  );

  let vtpassResult;
  try {
    vtpassResult = await purchaseService({
      request_id: requestId,
      serviceID: serviceId,
      variation_code: input.variation_code,
      amount: input.amount_kobo / 100,
      phone: input.phone,
      billersCode: input.phone,
    });
  } catch {
    await refundWallet(walletId, amountKobo, bill.id, reference);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    await db.billTransaction.update({ where: { id: bill.id }, data: { status: 'failed' } });
    throw new AppError(
      ErrorCode.EXTERNAL_SERVICE_ERROR,
      'Data service temporarily unavailable. Your wallet has been refunded.',
    );
  }

  const delivered = vtpassResult.code === '000';
  const pending = vtpassResult.code === '099';
  const status = delivered ? 'delivered' : pending ? 'pending' : 'failed';

  if (status === 'failed') await refundWallet(walletId, amountKobo, bill.id, reference);

  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  await db.billTransaction.update({
    where: { id: bill.id },
    data: {
      status,
      vtpass_order_id: vtpassResult.content.transactions.transactionId,
      completed_at: delivered ? new Date() : null,
    },
  });

  if (delivered) {
    const fcm = await getUserFcmToken(userId);
    if (fcm) {
      void sendPushNotification(
        fcm,
        'Data Purchased',
        `${input.network.toUpperCase()} data bundle activated on ${input.phone}`,
        { type: 'bill_data', bill_id: bill.id },
      );
    }
  }

  return toBillRecord(
    bill.id,
    userId,
    walletId,
    'data',
    serviceId,
    reference,
    requestId,
    status,
    amountKobo,
    { phone: input.phone, network: input.network, plan_name: input.variation_code },
    vtpassResult,
  );
}

// ---------------------------------------------------------------------------
// POST /bills/tv
// ---------------------------------------------------------------------------

export async function payTv(userId: string, input: PayTvInput): Promise<BillRecord> {
  await validatePin(userId, input.pin);
  const { walletId, kycTier } = await resolveWallet(userId);
  const amountKobo = BigInt(input.amount_kobo);

  const balance = await getBalance(walletId);
  if (balance < amountKobo) throw new AppError(ErrorCode.CONFLICT, 'Insufficient balance.');

  await checkDailyLimit(walletId, amountKobo, kycTier, 'other_bills_kobo');

  const reference = billReference();
  const requestId = generateVtpassRequestId();
  const serviceId = VTPASS_SERVICE_IDS[input.provider] ?? input.provider;

  const bill = await db.$transaction(
    async (tx: typeof db) => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      const row = (await tx.billTransaction.create({
        data: {
          user_id: userId,
          wallet_id: walletId,
          category: 'tv',
          service_id: serviceId,
          reference,
          vtpass_request_id: requestId,
          status: 'processing',
          amount: amountKobo,
          fee: BigInt(0),
          narration: `${input.provider.toUpperCase()} subscription — ${input.variation_code}`,
          recipient: {
            smartcard: input.smartcard,
            provider: input.provider,
            bouquet: input.variation_code,
          },
        },
      })) as { id: string };
      await debitWallet(tx, walletId, amountKobo, row.id, reference);
      return row;
    },
    { isolationLevel: 'Serializable' },
  );

  let vtpassResult;
  try {
    vtpassResult = await purchaseService({
      request_id: requestId,
      serviceID: serviceId,
      variation_code: input.variation_code,
      amount: input.amount_kobo / 100,
      phone: input.phone ?? '',
      billersCode: input.smartcard,
    });
  } catch {
    await refundWallet(walletId, amountKobo, bill.id, reference);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    await db.billTransaction.update({ where: { id: bill.id }, data: { status: 'failed' } });
    throw new AppError(
      ErrorCode.EXTERNAL_SERVICE_ERROR,
      'TV subscription service temporarily unavailable. Your wallet has been refunded.',
    );
  }

  const delivered = vtpassResult.code === '000';
  const pending = vtpassResult.code === '099';
  const status = delivered ? 'delivered' : pending ? 'pending' : 'failed';

  if (status === 'failed') await refundWallet(walletId, amountKobo, bill.id, reference);

  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  await db.billTransaction.update({
    where: { id: bill.id },
    data: {
      status,
      vtpass_order_id: vtpassResult.content.transactions.transactionId,
      completed_at: delivered ? new Date() : null,
    },
  });

  if (delivered) {
    const fcm = await getUserFcmToken(userId);
    if (fcm) {
      void sendPushNotification(
        fcm,
        'TV Subscription Renewed',
        `${input.provider.toUpperCase()} subscription renewed successfully`,
        { type: 'bill_tv', bill_id: bill.id },
      );
    }
  }

  return toBillRecord(
    bill.id,
    userId,
    walletId,
    'tv',
    serviceId,
    reference,
    requestId,
    status,
    amountKobo,
    { smartcard: input.smartcard, provider: input.provider, bouquet: input.variation_code },
    vtpassResult,
  );
}

// ---------------------------------------------------------------------------
// POST /bills/electricity
// ---------------------------------------------------------------------------

export async function payElectricity(
  userId: string,
  input: PayElectricityInput,
): Promise<BillRecord> {
  await validatePin(userId, input.pin);
  const { walletId, kycTier } = await resolveWallet(userId);
  const amountKobo = BigInt(input.amount_kobo);

  const balance = await getBalance(walletId);
  if (balance < amountKobo) throw new AppError(ErrorCode.CONFLICT, 'Insufficient balance.');

  await checkDailyLimit(walletId, amountKobo, kycTier, 'other_bills_kobo');

  const reference = billReference();
  const requestId = generateVtpassRequestId();
  const serviceId = VTPASS_SERVICE_IDS[input.disco] ?? input.disco;

  const bill = await db.$transaction(
    async (tx: typeof db) => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      const row = (await tx.billTransaction.create({
        data: {
          user_id: userId,
          wallet_id: walletId,
          category: 'electricity',
          service_id: serviceId,
          reference,
          vtpass_request_id: requestId,
          status: 'processing',
          amount: amountKobo,
          fee: BigInt(0),
          narration: `${input.disco} electricity — meter ${input.meter_number.slice(-4)}`,
          recipient: {
            meter_number: input.meter_number,
            meter_type: input.meter_type,
            disco: input.disco,
            customer_name: input.customer_name ?? null,
          },
        },
      })) as { id: string };
      await debitWallet(tx, walletId, amountKobo, row.id, reference);
      return row;
    },
    { isolationLevel: 'Serializable' },
  );

  let vtpassResult;
  try {
    vtpassResult = await purchaseService({
      request_id: requestId,
      serviceID: serviceId,
      variation_code: input.meter_type,
      amount: input.amount_kobo / 100,
      phone: input.phone,
      billersCode: input.meter_number,
    });
  } catch {
    await refundWallet(walletId, amountKobo, bill.id, reference);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    await db.billTransaction.update({ where: { id: bill.id }, data: { status: 'failed' } });
    throw new AppError(
      ErrorCode.EXTERNAL_SERVICE_ERROR,
      'Electricity service temporarily unavailable. Your wallet has been refunded.',
    );
  }

  const delivered = vtpassResult.code === '000';
  const pending = vtpassResult.code === '099';
  const status = delivered ? 'delivered' : pending ? 'pending' : 'failed';

  if (status === 'failed') await refundWallet(walletId, amountKobo, bill.id, reference);

  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  await db.billTransaction.update({
    where: { id: bill.id },
    data: {
      status,
      vtpass_order_id: vtpassResult.content.transactions.transactionId,
      purchased_code: vtpassResult.purchased_code ?? vtpassResult.token ?? null,
      units: vtpassResult.units ?? null,
      completed_at: delivered ? new Date() : null,
    },
  });

  if (delivered) {
    const fcm = await getUserFcmToken(userId);
    if (fcm) {
      const naira = (input.amount_kobo / 100).toLocaleString('en-NG');
      const token = vtpassResult.token ?? vtpassResult.purchased_code;
      void sendPushNotification(
        fcm,
        'Electricity Payment Successful',
        `₦${naira} electricity paid${token ? `. Token: ${token}` : ''}`,
        { type: 'bill_electricity', bill_id: bill.id, token: token ?? '' },
      );
    }
  }

  return toBillRecord(
    bill.id,
    userId,
    walletId,
    'electricity',
    serviceId,
    reference,
    requestId,
    status,
    amountKobo,
    { meter_number: input.meter_number, meter_type: input.meter_type, disco: input.disco },
    vtpassResult,
  );
}

// ---------------------------------------------------------------------------
// POST /bills/education
// ---------------------------------------------------------------------------

export async function payEducation(userId: string, input: PayEducationInput): Promise<BillRecord> {
  await validatePin(userId, input.pin);
  const { walletId, kycTier } = await resolveWallet(userId);
  const amountKobo = BigInt(input.amount_kobo);

  const balance = await getBalance(walletId);
  if (balance < amountKobo) throw new AppError(ErrorCode.CONFLICT, 'Insufficient balance.');

  await checkDailyLimit(walletId, amountKobo, kycTier, 'other_bills_kobo');

  const reference = billReference();
  const requestId = generateVtpassRequestId();
  const serviceId = VTPASS_SERVICE_IDS[input.product] ?? input.product;

  const bill = await db.$transaction(
    async (tx: typeof db) => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      const row = (await tx.billTransaction.create({
        data: {
          user_id: userId,
          wallet_id: walletId,
          category: 'education',
          service_id: serviceId,
          reference,
          vtpass_request_id: requestId,
          status: 'processing',
          amount: amountKobo,
          fee: BigInt(0),
          narration: `${input.product.toUpperCase()} — qty ${input.quantity}`,
          recipient: { exam_type: input.product, quantity: input.quantity, phone: input.phone },
        },
      })) as { id: string };
      await debitWallet(tx, walletId, amountKobo, row.id, reference);
      return row;
    },
    { isolationLevel: 'Serializable' },
  );

  let vtpassResult;
  try {
    vtpassResult = await purchaseService({
      request_id: requestId,
      serviceID: serviceId,
      amount: input.amount_kobo / 100,
      phone: input.phone,
      quantity: input.quantity,
    });
  } catch {
    await refundWallet(walletId, amountKobo, bill.id, reference);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    await db.billTransaction.update({ where: { id: bill.id }, data: { status: 'failed' } });
    throw new AppError(
      ErrorCode.EXTERNAL_SERVICE_ERROR,
      'Education service temporarily unavailable. Your wallet has been refunded.',
    );
  }

  const delivered = vtpassResult.code === '000';
  const pending = vtpassResult.code === '099';
  const status = delivered ? 'delivered' : pending ? 'pending' : 'failed';

  if (status === 'failed') await refundWallet(walletId, amountKobo, bill.id, reference);

  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  await db.billTransaction.update({
    where: { id: bill.id },
    data: {
      status,
      vtpass_order_id: vtpassResult.content.transactions.transactionId,
      purchased_code: vtpassResult.purchased_code ?? null,
      completed_at: delivered ? new Date() : null,
    },
  });

  if (delivered) {
    const fcm = await getUserFcmToken(userId);
    if (fcm) {
      void sendPushNotification(
        fcm,
        'Education Payment Successful',
        `${input.product.toUpperCase()} purchased successfully`,
        { type: 'bill_education', bill_id: bill.id },
      );
    }
  }

  return toBillRecord(
    bill.id,
    userId,
    walletId,
    'education',
    serviceId,
    reference,
    requestId,
    status,
    amountKobo,
    { exam_type: input.product, quantity: input.quantity },
    vtpassResult,
  );
}

// ---------------------------------------------------------------------------
// GET /bills — history
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
// GET /bills/:id
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
// POST /bills/:id/requery — manual VTPass status check
// ---------------------------------------------------------------------------

export async function requeryBill(id: string, userId: string): Promise<BillRecord> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const row = (await db.billTransaction.findFirst({
    where: { id, user_id: userId },
  })) as BillRow | null;

  if (!row) throw new AppError(ErrorCode.NOT_FOUND, 'Bill transaction not found.');
  if (row.status === 'delivered' || row.status === 'refunded') {
    return rowToRecord(row);
  }

  const result = await requeryTransaction(row.vtpass_request_id);
  const delivered = result.code === '000';
  const newStatus = delivered ? 'delivered' : row.status;

  if (delivered) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    await db.billTransaction.update({
      where: { id },
      data: { status: 'delivered', completed_at: new Date() },
    });
  }

  return rowToRecord({ ...row, status: newStatus });
}

// ---------------------------------------------------------------------------
// Internal helpers
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toBillRecord(
  id: string,
  userId: string,
  walletId: string,
  category: BillCategory,
  serviceId: string,
  reference: string,
  requestId: string,
  status: string,
  amountKobo: bigint,
  recipient: BillRecipient,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vtpassResult: any,
): BillRecord {
  return {
    id,
    user_id: userId,
    wallet_id: walletId,
    category,
    service_id: serviceId,
    transaction_number: transactionNumber(reference),
    reference,
    vtpass_request_id: requestId,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    vtpass_order_id: vtpassResult?.content?.transactions?.transactionId ?? null,
    status: status as BillRecord['status'],
    amount_kobo: amountKobo.toString(),
    fee_kobo: '0',
    narration: `${category} payment`,
    recipient,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    purchased_code: vtpassResult?.purchased_code ?? vtpassResult?.token ?? null,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    units: vtpassResult?.units ?? null,
    provider_response: null,
    created_at: new Date(),
    completed_at: status === 'delivered' ? new Date() : null,
  };
}
