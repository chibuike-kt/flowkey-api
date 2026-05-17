import * as crypto from 'crypto';
import { prisma } from '../../common/utils/prisma';
import { AppError, ErrorCode } from '../../common/errors/AppError';
import { logger } from '../../common/utils/logger';
import { TIER_LIMITS, type KycTier } from '../kyc/kyc.types';
import { transfersTotal } from '../../common/metrics/index';
import { isValidUniversalId, normaliseUniversalId } from '../universal-id/universal-id.service';
import { assertNotLocked, recordFailedAttempt, clearLockout } from '../auth/lockout.service';
import { checkInternalTransferFraud, checkBankTransferFraud } from './fraud.service';
import { bankTransferQueue } from '../../queues/index';
import type {
  RecipientPreview,
  InternalTransferResult,
  BankTransferResult,
  TransactionDetail,
  TransferSource,
  PaymentMethod,
} from './transfers.types';
import { sendPushNotification } from '../notifications/notification.service';
import type {
  InternalTransferInput,
  BankTransferInput,
  ListTransfersInput,
  UidInternalTransferInput,
  UidBankTransferInput,
} from './transfers.schema';
import * as argon2 from 'argon2';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateReference(): string {
  const d    = new Date();
  const date = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const rand = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `FLK-${date}-${rand}`;
}

function transactionNumber(reference: string): string {
  // FLK-20260517-8AD496 → TXN-8AD496
  const parts = reference.split('-');
  return `TXN-${parts[parts.length - 1] ?? reference}`;
}

function paymentMethodLabel(source: TransferSource, type: 'internal' | 'bank'): PaymentMethod {
  if (source === 'universal_id') {
    return type === 'internal'
      ? 'Universal ID — FlowKey to FlowKey'
      : 'Universal ID — FlowKey to Bank';
  }
  if (source === 'qr_code') return 'QR Code';
  return type === 'internal' ? 'FlowKey to FlowKey' : 'FlowKey to Bank';
}

async function getReceiverFcmToken(walletId: string): Promise<string | null> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const wallet = await db.wallet.findUnique({
    where:  { id: walletId },
    select: {
      user: {
        select: {
          device_sessions: {
            where:   { is_revoked: false },
            orderBy: { last_active: 'desc' },
            take:    1,
            select:  { fcm_token: true },
          },
        },
      },
    },
  }) as { user: { device_sessions: { fcm_token: string | null }[] } | null } | null;

  return wallet?.user?.device_sessions?.[0]?.fcm_token ?? null;
}

function toKobo(n: number): bigint {
  return BigInt(Math.round(n));
}

function bigintSum(agg: { _sum: { amount: bigint | null } }): bigint {
  return agg._sum.amount ?? BigInt(0);
}

// ---------------------------------------------------------------------------
// Types used internally
// ---------------------------------------------------------------------------

interface UserAuthRow {
  transaction_pin_hash:           string | null;
  transaction_pin_failed_attempts: number;
  transaction_pin_locked_until:    Date | null;
  transaction_pin_hard_locked:     boolean;
  transaction_pin_lockout_count:   number;
}

interface SenderRow {
  id:           string;
  kyc_tier:     number;
  account_status: string;
  wallet:       { id: string } | null;
  auth:         UserAuthRow | null;
}

interface TransactionRow {
  id:                  string;
  type:                string;
  status:              string;
  amount:              bigint;
  fee:                 bigint;
  net_amount:          bigint;
  narration:           string | null;
  reference:           string;
  metadata:            Record<string, unknown> | null;
  sender_wallet_id:    string | null;
  receiver_wallet_id:  string | null;
  initiator_id:        string;
  completed_at:        Date | null;
  created_at:          Date;
  updated_at:          Date;
  sender_wallet:       { user_id: string } | null;
  receiver_wallet:     { user_id: string } | null;
}

// ---------------------------------------------------------------------------
// Guard helpers
// ---------------------------------------------------------------------------

function assertActive(status: string, label: string): void {
  if (status !== 'active') {
    throw new AppError(ErrorCode.FORBIDDEN, `${label} account is not active.`);
  }
}

async function verifyPin(
  userId:       string,
  pinHash:      string,
  pin:          string,
  failCount:    number,
  lockoutCount: number,
  lockedUntil:  Date | null,
  hardLocked:   boolean,
): Promise<void> {
  await assertNotLocked(userId, 'pin', async () => ({
    hard_locked:  hardLocked,
    locked_until: lockedUntil,
  }));

  const valid = await argon2.verify(pinHash, pin);
  if (!valid) {
    const lock = await recordFailedAttempt(userId, 'pin', failCount, lockoutCount);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    await db.userAuth.update({
      where: { user_id: userId },
      data:  {
        transaction_pin_failed_attempts: lock.newFailCount,
        transaction_pin_locked_until:    lock.lockedUntil,
        transaction_pin_hard_locked:     lock.hardLocked,
        transaction_pin_lockout_count:   lock.newLockoutCount,
      },
    });
    throw new AppError(ErrorCode.INVALID_CREDENTIALS, 'Incorrect transaction PIN.');
  }

  await clearLockout(userId, 'pin');
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  await db.userAuth.update({
    where: { user_id: userId },
    data:  {
      transaction_pin_failed_attempts: 0,
      transaction_pin_locked_until:    null,
      transaction_pin_hard_locked:     false,
    },
  });
}

async function checkKycDailyLimit(
  walletId:    string,
  amountKobo:  bigint,
  txType:      string,
  limitKobo:   bigint,
  limitLabel:  string,
): Promise<void> {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const agg = await db.ledgerEntry.aggregate({
    where: {
      wallet_id:   walletId,
      type:        'debit',
      created_at:  { gte: todayStart },
      transaction: { type: txType },
    },
    _sum: { amount: true },
  });

  const used = bigintSum(agg as { _sum: { amount: bigint | null } });
  if (used + amountKobo > limitKobo) {
    throw new AppError(
      ErrorCode.FORBIDDEN,
      `Daily ${limitLabel} limit of ₦${(Number(limitKobo) / 100).toLocaleString()} reached for your KYC tier.`,
    );
  }
}

async function getBalanceInLock(tx: typeof db, walletId: string): Promise<bigint> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const [credits, debits] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    tx.ledgerEntry.aggregate({ where: { wallet_id: walletId, type: 'credit' }, _sum: { amount: true } }),
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    tx.ledgerEntry.aggregate({ where: { wallet_id: walletId, type: 'debit'  }, _sum: { amount: true } }),
  ]);
  return (
    bigintSum(credits as { _sum: { amount: bigint | null } }) -
    bigintSum(debits  as { _sum: { amount: bigint | null } })
  );
}

function assertSufficientBalance(balance: bigint, required: bigint): void {
  if (balance < required) {
    throw new AppError(
      ErrorCode.CONFLICT,
      `Insufficient balance. Available: ₦${(Number(balance) / 100).toLocaleString()}.`,
    );
  }
}

// ---------------------------------------------------------------------------
// POST /transfers/resolve-recipient
// ---------------------------------------------------------------------------

export async function resolveRecipient(
  identifier:       string,
  requestingUserId: string,
): Promise<RecipientPreview> {
  const normalised = identifier.trim();
  const isUid      = isValidUniversalId(normalised);

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const user = await db.user.findFirst({
    where: isUid
      ? { universal_id: normaliseUniversalId(normalised), deleted_at: null }
      : { username: normalised.toLowerCase(), deleted_at: null },
    select: {
      id: true, username: true, display_name: true, universal_id: true,
      account_status: true,
      wallet: { select: { id: true } },
    },
  });

  if (!user) throw new AppError(ErrorCode.NOT_FOUND, 'Recipient not found.');

  const u = user as {
    id: string; username: string; display_name: string | null;
    universal_id: string; account_status: string;
    wallet: { id: string } | null;
  };

  if (u.account_status !== 'active') throw new AppError(ErrorCode.CONFLICT, 'Recipient account is not active.');
  if (u.id === requestingUserId)      throw new AppError(ErrorCode.CONFLICT, 'You cannot transfer to yourself.');
  if (!u.wallet)                      throw new AppError(ErrorCode.NOT_FOUND, 'Recipient wallet not found.');

  return {
    user_id:      u.id,
    username:     u.username,
    display_name: u.display_name,
    universal_id: u.universal_id,
    wallet_id:    u.wallet.id,
  };
}

// ---------------------------------------------------------------------------
// POST /transfers/internal
// ---------------------------------------------------------------------------

export async function executeInternalTransfer(
  deviceUserId:   string,
  input:          InternalTransferInput,
  idempotencyKey: string,
): Promise<InternalTransferResult> {
  const amountKobo = toKobo(input.amount_kobo);
  const source     = input.source as TransferSource;

  // ── 1. Load sender (authenticated FlowKey user) ──────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const senderData = await db.user.findUnique({
    where: { id: deviceUserId },
    select: {
      kyc_tier: true, account_status: true,
      username: true, display_name: true,
      wallet: { select: { id: true } },
      auth: {
        select: {
          transaction_pin_hash: true,
          transaction_pin_failed_attempts: true,
          transaction_pin_locked_until: true,
          transaction_pin_hard_locked: true,
          transaction_pin_lockout_count: true,
        },
      },
    },
  }) as (Omit<SenderRow, 'id'> & { username: string; display_name: string | null }) | null;

  if (!senderData)        throw new AppError(ErrorCode.NOT_FOUND, 'Sender not found.');
  if (!senderData.wallet) throw new AppError(ErrorCode.NOT_FOUND, 'Your wallet not found.');
  if (!senderData.auth?.transaction_pin_hash) throw new AppError(ErrorCode.CONFLICT, 'Please set a transaction PIN first.');

  assertActive(senderData.account_status, 'Your');

  const senderUserId   = deviceUserId;
  const senderWalletId = senderData.wallet.id;
  const senderAuth     = senderData.auth;
  const senderKycTier  = senderData.kyc_tier < 1 ? 1 : senderData.kyc_tier;

  // ── 2. Guards ──────────────────────────────────────────────────────────────
  if (senderWalletId === input.recipient_wallet_id) {
    throw new AppError(ErrorCode.CONFLICT, 'You cannot transfer to yourself.');
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const recipientWallet = await db.wallet.findUnique({
    where: { id: input.recipient_wallet_id },
    select: {
      id: true,
      user: { select: { id: true, account_status: true, username: true, display_name: true } },
    },
  }) as { id: string; user: { id: string; account_status: string; username: string; display_name: string | null } | null } | null;

  if (!recipientWallet)                       throw new AppError(ErrorCode.NOT_FOUND, 'Recipient wallet not found.');
  if (recipientWallet.user?.account_status !== 'active') throw new AppError(ErrorCode.CONFLICT, 'Recipient account is not active.');

  // ── 3. Fraud + PIN + KYC ──────────────────────────────────────────────────
  await checkInternalTransferFraud(senderWalletId, amountKobo, source, undefined);

  await verifyPin(
    senderUserId, senderAuth.transaction_pin_hash!, input.pin,
    senderAuth.transaction_pin_failed_attempts,
    senderAuth.transaction_pin_lockout_count,
    senderAuth.transaction_pin_locked_until,
    senderAuth.transaction_pin_hard_locked,
  );

  const tier      = senderKycTier as KycTier;
  const dailyLimit = BigInt(TIER_LIMITS[tier].flowkey_to_flowkey_kobo);
  await checkKycDailyLimit(senderWalletId, amountKobo, 'transfer_internal', dailyLimit, 'transfer');

  // ── 4. Idempotency check — return existing result if key already used ────────
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const existingTxn = await db.transaction.findFirst({
    where: { idempotency_key: idempotencyKey, sender_wallet_id: senderWalletId },
    select: {
      id: true, reference: true, amount: true, fee: true, net_amount: true,
      narration: true, created_at: true, receiver_wallet_id: true,
    },
  }) as {
    id: string; reference: string; amount: bigint; fee: bigint; net_amount: bigint;
    narration: string | null; created_at: Date; receiver_wallet_id: string | null;
  } | null;

  if (existingTxn) {
    logger.info('Internal transfer idempotency hit — returning existing result', {
      transaction_id: existingTxn.id, idempotency_key: idempotencyKey,
    });
    return {
      transaction_id:     existingTxn.id,
      transaction_number: transactionNumber(existingTxn.reference),
      reference:          existingTxn.reference,
      transaction_date:   existingTxn.created_at.toISOString(),
      status:             'completed',
      payment_method:     paymentMethodLabel(source, 'internal'),
      amount_kobo:        existingTxn.amount.toString(),
      fee_kobo:           existingTxn.fee.toString(),
      net_amount_kobo:    existingTxn.net_amount.toString(),
      narration:          existingTxn.narration,
      sender: {
        user_id:      senderUserId,
        display_name: senderData.display_name ?? senderData.username,
        username:     senderData.username,
        wallet_id:    senderWalletId,
      },
      recipient: {
        user_id:      recipientWallet.user?.id ?? '',
        display_name: recipientWallet.user?.display_name ?? recipientWallet.user?.username ?? '',
        username:     recipientWallet.user?.username ?? '',
        wallet_id:    existingTxn.receiver_wallet_id ?? input.recipient_wallet_id,
      },
    };
  }

  // ── 5. Execute ─────────────────────────────────────────────────────────────
  const fee       = BigInt(0);
  const netAmount = amountKobo - fee;
  const reference = generateReference();

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const txn = await db.$transaction(async (tx: typeof db) => {
    const [wA, wB] = [senderWalletId, input.recipient_wallet_id].sort();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    await tx.$queryRaw`SELECT id FROM wallets WHERE id IN (${wA}::uuid, ${wB}::uuid) FOR UPDATE`;

    assertSufficientBalance(await getBalanceInLock(tx, senderWalletId), amountKobo);

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const row = await tx.transaction.create({
      data: {
        type:               'transfer_internal',
        status:             'completed',
        amount:             amountKobo,
        fee,
        net_amount:         netAmount,
        narration:          input.narration ?? null,
        reference,
        idempotency_key:    idempotencyKey,
        initiator_id:       deviceUserId,
        initiator_type:     'user',
        sender_wallet_id:   senderWalletId,
        receiver_wallet_id: input.recipient_wallet_id,
        completed_at:       new Date(),
        metadata: {
          source,
          device_id:           input.device_id ?? null,
          qr_token:            input.qr_token ?? null,
        },
      },
    });

    const txnId = (row as { id: string }).id;

    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    await tx.ledgerEntry.createMany({
      data: [
        { wallet_id: senderWalletId,           transaction_id: txnId, type: 'debit',  amount: amountKobo },
        { wallet_id: input.recipient_wallet_id, transaction_id: txnId, type: 'credit', amount: netAmount  },
      ],
    });

    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    await tx.receipt.create({
      data: { transaction_id: txnId, public_token: crypto.randomUUID() },
    });

    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    await tx.auditLog.create({
      data: {
        actor_id:      deviceUserId,
        actor_type:    'user',
        action:        'transfer.internal',
        target_type:   'transaction',
        target_id:     txnId,
        previous_hash: 'CHAINED',
        metadata: {
          sender_user_id:      senderUserId,
          sender_wallet_id:    senderWalletId,
          receiver_wallet_id:  input.recipient_wallet_id,
          amount_kobo:         amountKobo.toString(),
          reference, source,
          device_id:           input.device_id ?? null,
        },
      },
    });

    return row as {
      id: string; amount: bigint; fee: bigint; net_amount: bigint;
      narration: string | null; reference: string;
      sender_wallet_id: string; receiver_wallet_id: string; created_at: Date;
    };
  }, { isolationLevel: 'Serializable' });

  transfersTotal.inc({ type: 'internal', status: 'completed' });
  logger.info('Internal transfer completed', {
    transaction_id: txn.id, reference, source,
    amount_kobo: amountKobo.toString(),
  });

  // Push notification to receiver
  const receiverFcm = await getReceiverFcmToken(input.recipient_wallet_id);
  if (receiverFcm) {
    const senderName = senderData.display_name ?? senderData.username;
    const naira      = (Number(amountKobo) / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 });
    void sendPushNotification(
      receiverFcm,
      `You received ₦${naira}`,
      `${senderName} sent you ₦${naira}${txn.narration ? ` — ${txn.narration}` : ''}`,
      { transaction_id: txn.id, type: 'credit', amount_kobo: amountKobo.toString() },
    );
  }

  return {
    transaction_id:     txn.id,
    transaction_number: transactionNumber(reference),
    reference,
    transaction_date:   txn.created_at.toISOString(),
    status:             'completed',
    payment_method:     paymentMethodLabel(source, 'internal'),
    amount_kobo:        txn.amount.toString(),
    fee_kobo:           txn.fee.toString(),
    net_amount_kobo:    txn.net_amount.toString(),
    narration:          txn.narration,
    sender: {
      user_id:      senderUserId,
      display_name: senderData.display_name ?? senderData.username,
      username:     senderData.username,
      wallet_id:    senderWalletId,
    },
    recipient: {
      user_id:      recipientWallet.user?.id ?? '',
      display_name: recipientWallet.user?.display_name ?? recipientWallet.user?.username ?? '',
      username:     recipientWallet.user?.username ?? '',
      wallet_id:    input.recipient_wallet_id,
    },
  };
}

// ---------------------------------------------------------------------------
// POST /transfers/bank
// ---------------------------------------------------------------------------

export async function initiateBankTransfer(
  senderUserId:   string,
  input:          BankTransferInput,
  idempotencyKey: string,
): Promise<BankTransferResult> {
  const amountKobo = toKobo(input.amount_kobo);

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const sender = await db.user.findUnique({
    where: { id: senderUserId },
    select: {
      kyc_tier: true, account_status: true,
      username: true, display_name: true,
      wallet: { select: { id: true } },
      auth: {
        select: {
          transaction_pin_hash: true,
          transaction_pin_failed_attempts: true,
          transaction_pin_locked_until: true,
          transaction_pin_hard_locked: true,
          transaction_pin_lockout_count: true,
        },
      },
    },
  }) as (Omit<SenderRow, 'id'> & { username: string; display_name: string | null }) | null;

  if (!sender)        throw new AppError(ErrorCode.NOT_FOUND, 'Sender not found.');
  if (!sender.wallet) throw new AppError(ErrorCode.NOT_FOUND, 'Your wallet not found.');
  if (!sender.auth?.transaction_pin_hash) throw new AppError(ErrorCode.CONFLICT, 'Please set a transaction PIN first.');

  assertActive(sender.account_status, 'Your');

  const senderWalletId = sender.wallet.id;
  const auth           = sender.auth;
  const tier           = (sender.kyc_tier < 1 ? 1 : sender.kyc_tier) as KycTier;

  await checkBankTransferFraud(senderWalletId, amountKobo);

  const dailyLimit = BigInt(TIER_LIMITS[tier].flowkey_to_bank_kobo);
  await checkKycDailyLimit(senderWalletId, amountKobo, 'transfer_bank', dailyLimit, 'bank transfer');

  await verifyPin(
    senderUserId, auth.transaction_pin_hash!, input.pin,
    auth.transaction_pin_failed_attempts,
    auth.transaction_pin_lockout_count,
    auth.transaction_pin_locked_until,
    auth.transaction_pin_hard_locked,
  );

  // Idempotency check
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const existingBankTxn = await db.transaction.findFirst({
    where: { idempotency_key: idempotencyKey, sender_wallet_id: senderWalletId },
    select: { id: true, reference: true, amount: true, fee: true, net_amount: true, narration: true, created_at: true },
  }) as { id: string; reference: string; amount: bigint; fee: bigint; net_amount: bigint; narration: string | null; created_at: Date } | null;

  if (existingBankTxn) {
    logger.info('Bank transfer idempotency hit — returning existing result', {
      transaction_id: existingBankTxn.id, idempotency_key: idempotencyKey,
    });
    return {
      transaction_id:     existingBankTxn.id,
      transaction_number: transactionNumber(existingBankTxn.reference),
      reference:          existingBankTxn.reference,
      transaction_date:   existingBankTxn.created_at.toISOString(),
      status:             'pending' as const,
      payment_method:     'FlowKey to Bank' as const,
      amount_kobo:        existingBankTxn.amount.toString(),
      fee_kobo:           existingBankTxn.fee.toString(),
      net_amount_kobo:    existingBankTxn.net_amount.toString(),
      narration:          existingBankTxn.narration,
      sender: { user_id: senderUserId, display_name: sender.display_name ?? sender.username, username: sender.username, wallet_id: senderWalletId },
      recipient: { account_number: `****${input.account_number.slice(-4)}`, account_name: input.verified_account_name, bank_name: input.bank_name, bank_code: input.bank_code },
      estimated_settlement: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      completed_at: null,
    };
  }

  const fee                 = tier === 1 ? BigInt(5_000) : BigInt(0); // ₦50 for Tier 1
  const netAmount           = amountKobo - fee;
  const reference           = generateReference();
  const estimatedSettlement = new Date(Date.now() + 5 * 60 * 1000);

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const txn = await db.$transaction(async (tx: typeof db) => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    await tx.$queryRaw`SELECT id FROM wallets WHERE id = ${senderWalletId}::uuid FOR UPDATE`;

    assertSufficientBalance(await getBalanceInLock(tx, senderWalletId), amountKobo);

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const row = await tx.transaction.create({
      data: {
        type:               'transfer_bank',
        status:             'pending',
        amount:             amountKobo,
        fee,
        net_amount:         netAmount,
        narration:          input.narration ?? null,
        reference,
        idempotency_key:    idempotencyKey,
        initiator_id:       senderUserId,
        initiator_type:     'user',
        sender_wallet_id:   senderWalletId,
        receiver_wallet_id: null,
        metadata: {
          bank_code:             input.bank_code,
          account_number_last4:  input.account_number.slice(-4),
          account_name:          input.account_name,
          bank_name:             input.bank_name,
          verified_account_name: input.verified_account_name,
          device_id:             input.device_id ?? null,
          estimated_settlement:  estimatedSettlement.toISOString(),
        },
      },
    });

    const txnId = (row as { id: string }).id;

    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    await tx.ledgerEntry.create({
      data: { wallet_id: senderWalletId, transaction_id: txnId, type: 'debit', amount: amountKobo },
    });

    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    await tx.receipt.create({
      data: { transaction_id: txnId, public_token: crypto.randomUUID() },
    });

    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    await tx.auditLog.create({
      data: {
        actor_id:      senderUserId,
        actor_type:    'user',
        action:        'transfer.bank.initiated',
        target_type:   'transaction',
        target_id:     txnId,
        previous_hash: 'CHAINED',
        metadata: {
          sender_wallet_id: senderWalletId,
          amount_kobo:      amountKobo.toString(),
          fee_kobo:         fee.toString(),
          bank_code:        input.bank_code,
          account_last4:    input.account_number.slice(-4),
          reference,
        },
      },
    });

    return row as {
      id: string; amount: bigint; fee: bigint; net_amount: bigint;
      narration: string | null; created_at: Date;
    };
  }, { isolationLevel: 'Serializable' });

  await bankTransferQueue.add(
    'process_bank_transfer',
    {
      transactionId:  txn.id,
      reference,
      senderWalletId,
      amountKobo:     amountKobo.toString(),
      bankCode:       input.bank_code,
      accountNumber:  input.account_number,
      accountName:    input.account_name,
      narration:      input.narration ?? null,
      attemptNumber:  1,
    },
    {
      jobId:    `bank-transfer:${txn.id}`,
      delay:    2000,
      attempts: 3,
      backoff:  { type: 'exponential', delay: 5000 },
    },
  );

  transfersTotal.inc({ type: 'bank', status: 'pending' });
  logger.info('Bank transfer initiated', {
    transaction_id: txn.id, reference,
    amount_kobo:    amountKobo.toString(),
    bank_code:      input.bank_code,
    account_last4:  input.account_number.slice(-4),
  });

  // Notify sender — bank transfer is processing
  const bankSenderFcm = await getReceiverFcmToken(senderWalletId);
  if (bankSenderFcm) {
    const naira = (Number(amountKobo) / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 });
    void sendPushNotification(
      bankSenderFcm,
      'Bank Transfer Initiated',
      `₦${naira} to ${input.account_name} (${input.bank_name}) is being processed`,
      { transaction_id: txn.id, type: 'bank_transfer_pending', amount_kobo: amountKobo.toString() },
    );
  }

  return {
    transaction_id:     txn.id,
    transaction_number: transactionNumber(reference),
    reference,
    transaction_date:   txn.created_at.toISOString(),
    status:             'pending',
    payment_method:     paymentMethodLabel('username', 'bank'),
    amount_kobo:        txn.amount.toString(),
    fee_kobo:           txn.fee.toString(),
    net_amount_kobo:    txn.net_amount.toString(),
    narration:          txn.narration,
    sender: {
      user_id:      senderUserId,
      display_name: sender.display_name ?? sender.username,
      username:     sender.username,
      wallet_id:    senderWalletId,
    },
    recipient: {
      account_number: `****${input.account_number.slice(-4)}`,
      account_name:   input.verified_account_name,
      bank_name:      input.bank_name,
      bank_code:      input.bank_code,
    },
    estimated_settlement: estimatedSettlement.toISOString(),
    completed_at:         null,
  };
}

// ---------------------------------------------------------------------------
// Auto-reversal — called by BullMQ worker on bank transfer failure
// ---------------------------------------------------------------------------

export async function reverseBankTransfer(
  originalTransactionId: string,
  senderWalletId:        string,
  amountKobo:            bigint,
  failureReason:         string,
): Promise<void> {
  const reversalReference = `REV-${generateReference()}`;

  await db.$transaction(async (tx: typeof db) => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    await tx.$queryRaw`SELECT id FROM wallets WHERE id = ${senderWalletId}::uuid FOR UPDATE`;

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const reversalTxn = await tx.transaction.create({
      data: {
        type:               'reversal',
        status:             'completed',
        amount:             amountKobo,
        fee:                BigInt(0),
        net_amount:         amountKobo,
        narration:          `Reversal: bank transfer failed — ${failureReason}`,
        reference:          reversalReference,
        idempotency_key:    crypto.randomUUID(),
        initiator_id:       null,
        initiator_type:     'system',
        sender_wallet_id:   null,
        receiver_wallet_id: senderWalletId,
        completed_at:       new Date(),
        metadata: { original_transaction_id: originalTransactionId, failure_reason: failureReason },
      },
    });

    const reversalTxnId = (reversalTxn as { id: string }).id;

    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    await tx.ledgerEntry.create({
      data: { wallet_id: senderWalletId, transaction_id: reversalTxnId, type: 'credit', amount: amountKobo },
    });

    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    await tx.transaction.update({
      where: { id: originalTransactionId },
      data:  { status: 'reversed' },
    });

    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    await tx.reversal.create({
      data: {
        original_transaction_id: originalTransactionId,
        reversal_transaction_id: reversalTxnId,
        admin_id:                '00000000-0000-0000-0000-000000000000',
        reason_code:             'bank_transfer_failed',
        note:                    failureReason,
      },
    });

    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    await tx.auditLog.create({
      data: {
        actor_id:      null,
        actor_type:    'system',
        action:        'transfer.bank.reversed',
        target_type:   'transaction',
        target_id:     originalTransactionId,
        previous_hash: 'CHAINED',
        metadata: {
          reversal_transaction_id: reversalTxnId,
          sender_wallet_id:        senderWalletId,
          amount_kobo:             amountKobo.toString(),
          failure_reason:          failureReason,
          reversal_reference:      reversalReference,
        },
      },
    });
  }, { isolationLevel: 'Serializable' });

  logger.info('Bank transfer reversed', {
    original_transaction_id: originalTransactionId,
    reversal_reference:      reversalReference,
    amount_kobo:             amountKobo.toString(),
  });

  // Notify wallet owner — reversal credited back
  const reversalFcm = await getReceiverFcmToken(senderWalletId);
  if (reversalFcm) {
    const naira = (Number(amountKobo) / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 });
    void sendPushNotification(
      reversalFcm,
      'Transfer Reversed',
      `₦${naira} has been returned to your wallet — bank transfer could not be completed`,
      { type: 'reversal', amount_kobo: amountKobo.toString(), original_transaction_id: originalTransactionId },
    );
  }
}

// ---------------------------------------------------------------------------
// GET /transfers/:id
// ---------------------------------------------------------------------------

export async function getTransactionById(
  transactionId:    string,
  requestingUserId: string,
): Promise<TransactionDetail> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const row = await db.transaction.findUnique({
    where: { id: transactionId },
    select: {
      id: true, type: true, status: true,
      amount: true, fee: true, net_amount: true,
      narration: true, reference: true, metadata: true,
      sender_wallet_id: true, receiver_wallet_id: true,
      initiator_id: true,
      completed_at: true, created_at: true, updated_at: true,
      sender_wallet:   { select: { user_id: true } },
      receiver_wallet: { select: { user_id: true } },
    },
  }) as TransactionRow | null;

  if (!row) throw new AppError(ErrorCode.NOT_FOUND, 'Transaction not found.');

  const isSender    = row.sender_wallet?.user_id    === requestingUserId;
  const isReceiver  = row.receiver_wallet?.user_id  === requestingUserId;
  const isInitiator = row.initiator_id              === requestingUserId;

  if (!isSender && !isReceiver && !isInitiator) {
    throw new AppError(ErrorCode.FORBIDDEN, 'You do not have access to this transaction.');
  }

  return rowToDetail(row);
}

// ---------------------------------------------------------------------------
// GET /transfers
// ---------------------------------------------------------------------------

export async function listTransactions(
  userId: string,
  input:  ListTransfersInput,
): Promise<{ items: TransactionDetail[]; next_cursor: string | null }> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const wallet = await db.wallet.findUnique({
    where: { user_id: userId },
    select: { id: true },
  }) as { id: string } | null;

  if (!wallet) return { items: [], next_cursor: null };

  const walletId = wallet.id;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: Record<string, any> = { deleted_at: null };

  if (input.direction === 'sent') {
    where['sender_wallet_id'] = walletId;
  } else if (input.direction === 'received') {
    where['receiver_wallet_id'] = walletId;
  } else {
    where['OR'] = [{ sender_wallet_id: walletId }, { receiver_wallet_id: walletId }];
  }

  if (input.type !== 'all') {
    where['type'] = input.type === 'internal' ? 'transfer_internal' : 'transfer_bank';
  }
  if (input.status) where['status'] = input.status;

  if (input.cursor) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const pivot = await db.transaction.findUnique({
      where: { id: input.cursor }, select: { created_at: true },
    }) as { created_at: Date } | null;
    if (pivot) where['created_at'] = { lt: pivot.created_at };
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const rows = await db.transaction.findMany({
    where,
    orderBy: { created_at: 'desc' },
    take:    input.limit + 1,
    select: {
      id: true, type: true, status: true,
      amount: true, fee: true, net_amount: true,
      narration: true, reference: true, metadata: true,
      sender_wallet_id: true, receiver_wallet_id: true,
      initiator_id: true,
      completed_at: true, created_at: true, updated_at: true,
      sender_wallet:   { select: { user_id: true } },
      receiver_wallet: { select: { user_id: true } },
    },
  }) as TransactionRow[];

  const items     = rows.slice(0, input.limit).map(rowToDetail);
  const nextCursor = rows.length > input.limit ? (items[items.length - 1]?.id ?? null) : null;

  return { items, next_cursor: nextCursor };
}

// ---------------------------------------------------------------------------
// POST /transfers/:id/retry
// ---------------------------------------------------------------------------

export async function retryBankTransfer(
  transactionId:    string,
  requestingUserId: string,
  pin:              string,
): Promise<BankTransferResult> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const row = await db.transaction.findUnique({
    where: { id: transactionId },
    select: {
      id: true, type: true, status: true,
      amount: true, fee: true, net_amount: true,
      narration: true, reference: true, metadata: true,
      sender_wallet_id: true, created_at: true, completed_at: true,
      sender_wallet: { select: { user_id: true } },
    },
  }) as Pick<TransactionRow, 'id' | 'type' | 'status' | 'amount' | 'fee' | 'net_amount' | 'narration' | 'reference' | 'metadata' | 'sender_wallet_id' | 'created_at' | 'completed_at' | 'sender_wallet'> | null;

  if (!row) throw new AppError(ErrorCode.NOT_FOUND, 'Transaction not found.');

  if (row.sender_wallet?.user_id !== requestingUserId) throw new AppError(ErrorCode.FORBIDDEN, 'You can only retry your own transfers.');
  if (row.type   !== 'transfer_bank') throw new AppError(ErrorCode.CONFLICT, 'Only bank transfers can be retried.');
  if (row.status !== 'failed')        throw new AppError(ErrorCode.CONFLICT, `Transfer cannot be retried in status: ${row.status}.`);

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const auth = await db.userAuth.findUnique({
    where: { user_id: requestingUserId },
    select: {
      transaction_pin_hash: true,
      transaction_pin_failed_attempts: true,
      transaction_pin_locked_until: true,
      transaction_pin_hard_locked: true,
      transaction_pin_lockout_count: true,
    },
  }) as UserAuthRow | null;

  if (!auth?.transaction_pin_hash) throw new AppError(ErrorCode.CONFLICT, 'Transaction PIN not set.');

  await verifyPin(
    requestingUserId, auth.transaction_pin_hash, pin,
    auth.transaction_pin_failed_attempts,
    auth.transaction_pin_lockout_count,
    auth.transaction_pin_locked_until,
    auth.transaction_pin_hard_locked,
  );

  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  await db.transaction.update({ where: { id: transactionId }, data: { status: 'pending' } });

  const meta          = row.metadata ?? {};
  const prevAttempts  = (meta['attempt_number'] as number | undefined) ?? 1;

  await bankTransferQueue.add(
    'process_bank_transfer',
    {
      transactionId,
      reference:     row.reference,
      senderWalletId: row.sender_wallet_id!,
      amountKobo:    row.amount.toString(),
      bankCode:      meta['bank_code'] as string,
      accountNumber: `000000${meta['account_number_last4'] as string}`,
      accountName:   meta['account_name'] as string,
      narration:     row.narration,
      attemptNumber: prevAttempts + 1,
    },
    {
      jobId:    `bank-transfer:retry:${transactionId}:${Date.now()}`,
      delay:    1000,
      attempts: 2,
      backoff:  { type: 'exponential', delay: 5000 },
    },
  );

  logger.info('Bank transfer retry queued', { transaction_id: transactionId, attempt: prevAttempts + 1 });

  return {
    transaction_id:       row.id,
    reference:          row.reference,
    transaction_number: transactionNumber(row.reference),
    transaction_date:   row.created_at.toISOString(),
    status:             'pending',
    payment_method:     'FlowKey to Bank' as const,
    amount_kobo:        row.amount.toString(),
    fee_kobo:           row.fee.toString(),
    net_amount_kobo:    row.net_amount.toString(),
    narration:          row.narration,
    sender: {
      user_id:      requestingUserId,
      display_name: '',
      username:     '',
      wallet_id:    row.sender_wallet_id!,
    },
    recipient: {
      account_number: `****${(meta['account_number_last4'] as string | undefined) ?? '????'}`,
      account_name:   (meta['verified_account_name'] as string | undefined) ?? '',
      bank_name:      (meta['bank_name'] as string | undefined) ?? '',
      bank_code:      (meta['bank_code'] as string | undefined) ?? '',
    },
    estimated_settlement: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    completed_at:         null,
  };
}

// ---------------------------------------------------------------------------
// UID transfer — authenticate with Universal ID + UPP (no Bearer token)
// ---------------------------------------------------------------------------

async function verifyUpp(
  userId:       string,
  uppHash:      string,
  upp:          string,
  failCount:    number,
  lockoutCount: number,
  lockedUntil:  Date | null,
  hardLocked:   boolean,
): Promise<void> {
  await assertNotLocked(userId, 'passcode', async () => ({
    hard_locked:  hardLocked,
    locked_until: lockedUntil,
  }));

  const valid = await argon2.verify(uppHash, upp);
  if (!valid) {
    const lock = await recordFailedAttempt(userId, 'passcode', failCount, lockoutCount);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    await db.userAuth.update({
      where: { user_id: userId },
      data:  {
        upp_failed_attempts:  lock.newFailCount,
        upp_locked_until:     lock.lockedUntil,
        upp_hard_locked:      lock.hardLocked,
        upp_lockout_count:    lock.newLockoutCount,
      },
    });
    throw new AppError(ErrorCode.INVALID_CREDENTIALS, 'Incorrect Universal Payment PIN.');
  }

  await clearLockout(userId, 'passcode');
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  await db.userAuth.update({
    where: { user_id: userId },
    data:  {
      upp_failed_attempts: 0,
      upp_locked_until:    null,
      upp_hard_locked:     false,
    },
  });
}

async function loadUidSender(universalId: string): Promise<{
  userId: string; walletId: string; kycTier: KycTier;
  displayName: string; username: string;
  auth: {
    upp_hash: string | null;
    upp_failed_attempts: number;
    upp_locked_until: Date | null;
    upp_hard_locked: boolean;
    upp_lockout_count: number;
  };
}> {
  const uid = normaliseUniversalId(universalId);

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const user = await db.user.findFirst({
    where: { universal_id: uid, account_status: 'active', deleted_at: null },
    select: {
      id: true, kyc_tier: true, account_status: true,
      username: true, display_name: true,
      wallet: { select: { id: true } },
      auth: {
        select: {
          upp_hash:             true,
          upp_failed_attempts:  true,
          upp_locked_until:     true,
          upp_hard_locked:      true,
          upp_lockout_count:    true,
        },
      },
    },
  }) as {
    id: string; kyc_tier: number; account_status: string;
    username: string; display_name: string | null;
    wallet: { id: string } | null;
    auth: {
      upp_hash: string | null;
      upp_failed_attempts: number;
      upp_locked_until: Date | null;
      upp_hard_locked: boolean;
      upp_lockout_count: number;
    } | null;
  } | null;

  if (!user)             throw new AppError(ErrorCode.NOT_FOUND, 'Universal ID not found.');
  if (!user.wallet)      throw new AppError(ErrorCode.NOT_FOUND, 'Wallet not found.');
  // username is always set on active accounts
  if (!user.auth?.upp_hash) {
    throw new AppError(ErrorCode.CONFLICT, 'Universal Payment PIN not set. Set your UPP in the FlowKey app before using UID transfers.');
  }

  return {
    userId:      user.id,
    walletId:    user.wallet.id,
    kycTier:     (user.kyc_tier < 1 ? 1 : user.kyc_tier) as KycTier,
    auth:        user.auth,
    displayName: user.display_name ?? user.username,
    username:    user.username,
  };
}

/**
 * UID internal transfer — 3rd party app initiates a FlowKey-to-FlowKey
 * transfer on behalf of a user, authenticated via Universal ID + UPP.
 * No Bearer token required.
 */
export async function executeUidInternalTransfer(
  input:          UidInternalTransferInput,
  idempotencyKey: string,
  deviceUserId:   string,  // the friend's user ID — for audit only
): Promise<InternalTransferResult> {
  const amountKobo = toKobo(input.amount_kobo);
  const sender     = await loadUidSender(input.universal_id);

  if (sender.walletId === input.recipient_wallet_id) {
    throw new AppError(ErrorCode.CONFLICT, 'You cannot transfer to yourself.');
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const recipientWallet = await db.wallet.findUnique({
    where: { id: input.recipient_wallet_id },
    select: { id: true, user: { select: { account_status: true } } },
  }) as { id: string; user: { account_status: string } | null } | null;

  if (!recipientWallet || recipientWallet.user?.account_status !== 'active') {
    throw new AppError(ErrorCode.NOT_FOUND, 'Recipient wallet not found or inactive.');
  }

  await checkInternalTransferFraud(sender.walletId, amountKobo, 'universal_id', input.universal_id);

  // UPP auth — not PIN
  await verifyUpp(
    sender.userId,
    sender.auth.upp_hash!,
    input.upp,
    sender.auth.upp_failed_attempts,
    sender.auth.upp_lockout_count,
    sender.auth.upp_locked_until,
    sender.auth.upp_hard_locked,
  );

  const dailyLimit = BigInt(TIER_LIMITS[sender.kycTier].flowkey_to_flowkey_kobo);
  await checkKycDailyLimit(sender.walletId, amountKobo, 'transfer_internal', dailyLimit, 'transfer');

  const fee       = BigInt(0);
  const netAmount = amountKobo - fee;
  const reference = generateReference();

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const txn = await db.$transaction(async (tx: typeof db) => {
    const [wA, wB] = [sender.walletId, input.recipient_wallet_id].sort();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    await tx.$queryRaw`SELECT id FROM wallets WHERE id IN (${wA}::uuid, ${wB}::uuid) FOR UPDATE`;

    assertSufficientBalance(await getBalanceInLock(tx, sender.walletId), amountKobo);

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const row = await tx.transaction.create({
      data: {
        type:               'transfer_internal',
        status:             'completed',
        amount:             amountKobo,
        fee,
        net_amount:         netAmount,
        narration:          input.narration ?? null,
        reference,
        idempotency_key:    idempotencyKey,
        initiator_id:       sender.userId,
        initiator_type:     'user',
        sender_wallet_id:   sender.walletId,
        receiver_wallet_id: input.recipient_wallet_id,
        completed_at:       new Date(),
        metadata: {
          source:         'universal_id',
          universal_id:   input.universal_id,
          auth_method:    'upp',
        },
      },
    });

    const txnId = (row as { id: string }).id;

    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    await tx.ledgerEntry.createMany({
      data: [
        { wallet_id: sender.walletId,          transaction_id: txnId, type: 'debit',  amount: amountKobo },
        { wallet_id: input.recipient_wallet_id, transaction_id: txnId, type: 'credit', amount: netAmount  },
      ],
    });

    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    await tx.receipt.create({
      data: { transaction_id: txnId, public_token: crypto.randomUUID() },
    });

    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    await tx.auditLog.create({
      data: {
        actor_id:      sender.userId,
        actor_type:    'user',
        action:        'transfer.uid.internal',
        target_type:   'transaction',
        target_id:     txnId,
        previous_hash: 'CHAINED',
        metadata: {
          universal_id:        input.universal_id,
          sender_wallet_id:    sender.walletId,
          receiver_wallet_id:  input.recipient_wallet_id,
          amount_kobo:         amountKobo.toString(),
          auth_method:         'upp',
          device_user_id:      deviceUserId,  // friend's account — device context
          reference,
        },
      },
    });

    return row as {
      id: string; amount: bigint; fee: bigint; net_amount: bigint;
      narration: string | null; reference: string;
      sender_wallet_id: string; receiver_wallet_id: string; created_at: Date;
    };
  }, { isolationLevel: 'Serializable' });

  transfersTotal.inc({ type: 'internal', status: 'completed' });
  logger.info('UID internal transfer completed', {
    transaction_id: txn.id, reference,
    amount_kobo: amountKobo.toString(),
    universal_id: input.universal_id,
  });

  // Push notification to receiver
  const uidReceiverFcm = await getReceiverFcmToken(input.recipient_wallet_id);
  if (uidReceiverFcm) {
    const naira = (Number(amountKobo) / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 });
    void sendPushNotification(
      uidReceiverFcm,
      `You received ₦${naira}`,
      `${sender.displayName} sent you ₦${naira}${txn.narration ? ` — ${txn.narration}` : ''}`,
      { transaction_id: txn.id, type: 'credit', amount_kobo: amountKobo.toString() },
    );
  }

  // Load recipient details for response
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const uidRecipientWallet = await db.wallet.findUnique({
    where:  { id: input.recipient_wallet_id },
    select: { user: { select: { id: true, username: true, display_name: true } } },
  }) as { user: { id: string; username: string; display_name: string | null } | null } | null;

  return {
    transaction_id:     txn.id,
    transaction_number: transactionNumber(reference),
    reference,
    transaction_date:   txn.created_at.toISOString(),
    status:             'completed',
    payment_method:     paymentMethodLabel('universal_id', 'internal'),
    amount_kobo:        txn.amount.toString(),
    fee_kobo:           txn.fee.toString(),
    net_amount_kobo:    txn.net_amount.toString(),
    narration:          txn.narration,
    sender: {
      user_id:      sender.userId,
      display_name: sender.displayName,
      username:     sender.username,
      wallet_id:    sender.walletId,
    },
    recipient: {
      user_id:      uidRecipientWallet?.user?.id ?? '',
      display_name: uidRecipientWallet?.user?.display_name ?? uidRecipientWallet?.user?.username ?? '',
      username:     uidRecipientWallet?.user?.username ?? '',
      wallet_id:    input.recipient_wallet_id,
    },
  };
}

/**
 * UID bank transfer — 3rd party app initiates a FlowKey-to-Bank transfer
 * on behalf of a user, authenticated via Universal ID + UPP.
 * No Bearer token required.
 */
export async function executeUidBankTransfer(
  input:          UidBankTransferInput,
  idempotencyKey: string,
  deviceUserId:   string,  // the friend's user ID — for audit only
): Promise<BankTransferResult> {
  const amountKobo = toKobo(input.amount_kobo);
  const sender     = await loadUidSender(input.universal_id);

  await checkBankTransferFraud(sender.walletId, amountKobo);

  // UPP auth
  await verifyUpp(
    sender.userId,
    sender.auth.upp_hash!,
    input.upp,
    sender.auth.upp_failed_attempts,
    sender.auth.upp_lockout_count,
    sender.auth.upp_locked_until,
    sender.auth.upp_hard_locked,
  );

  const dailyLimit = BigInt(TIER_LIMITS[sender.kycTier].flowkey_to_bank_kobo);
  await checkKycDailyLimit(sender.walletId, amountKobo, 'transfer_bank', dailyLimit, 'bank transfer');

  const fee                 = sender.kycTier === 1 ? BigInt(5_000) : BigInt(0);
  const netAmount           = amountKobo - fee;
  const reference           = generateReference();
  const estimatedSettlement = new Date(Date.now() + 5 * 60 * 1000);

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const txn = await db.$transaction(async (tx: typeof db) => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    await tx.$queryRaw`SELECT id FROM wallets WHERE id = ${sender.walletId}::uuid FOR UPDATE`;

    assertSufficientBalance(await getBalanceInLock(tx, sender.walletId), amountKobo);

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const row = await tx.transaction.create({
      data: {
        type:               'transfer_bank',
        status:             'pending',
        amount:             amountKobo,
        fee,
        net_amount:         netAmount,
        narration:          input.narration ?? null,
        reference,
        idempotency_key:    idempotencyKey,
        initiator_id:       sender.userId,
        initiator_type:     'user',
        sender_wallet_id:   sender.walletId,
        receiver_wallet_id: null,
        metadata: {
          source:                'universal_id',
          universal_id:          input.universal_id,
          auth_method:           'upp',
          bank_code:             input.bank_code,
          account_number_last4:  input.account_number.slice(-4),
          account_name:          input.account_name,
          bank_name:             input.bank_name,
          verified_account_name: input.verified_account_name,
          estimated_settlement:  estimatedSettlement.toISOString(),
        },
      },
    });

    const txnId = (row as { id: string }).id;

    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    await tx.ledgerEntry.create({
      data: { wallet_id: sender.walletId, transaction_id: txnId, type: 'debit', amount: amountKobo },
    });

    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    await tx.receipt.create({
      data: { transaction_id: txnId, public_token: crypto.randomUUID() },
    });

    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    await tx.auditLog.create({
      data: {
        actor_id:      sender.userId,
        actor_type:    'user',
        action:        'transfer.uid.bank.initiated',
        target_type:   'transaction',
        target_id:     txnId,
        previous_hash: 'CHAINED',
        metadata: {
          universal_id:     input.universal_id,
          sender_wallet_id: sender.walletId,
          amount_kobo:      amountKobo.toString(),
          fee_kobo:         fee.toString(),
          bank_code:        input.bank_code,
          account_last4:    input.account_number.slice(-4),
          auth_method:      'upp',
          device_user_id:   deviceUserId,  // friend's account — device context
          reference,
        },
      },
    });

    return row as {
      id: string; amount: bigint; fee: bigint; net_amount: bigint;
      narration: string | null; created_at: Date;
    };
  }, { isolationLevel: 'Serializable' });

  await bankTransferQueue.add(
    'process_bank_transfer',
    {
      transactionId:  txn.id,
      reference,
      senderWalletId: sender.walletId,
      amountKobo:     amountKobo.toString(),
      bankCode:       input.bank_code,
      accountNumber:  input.account_number,
      accountName:    input.account_name,
      narration:      input.narration ?? null,
      attemptNumber:  1,
    },
    {
      jobId:    `bank-transfer:${txn.id}`,
      delay:    2000,
      attempts: 3,
      backoff:  { type: 'exponential', delay: 5000 },
    },
  );

  transfersTotal.inc({ type: 'bank', status: 'pending' });
  logger.info('UID bank transfer initiated', {
    transaction_id: txn.id, reference,
    universal_id:   input.universal_id,
    amount_kobo:    amountKobo.toString(),
    account_last4:  input.account_number.slice(-4),
  });

  // Notify UID owner — their bank transfer is processing
  const uidBankSenderFcm = await getReceiverFcmToken(sender.walletId);
  if (uidBankSenderFcm) {
    const naira = (Number(amountKobo) / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 });
    void sendPushNotification(
      uidBankSenderFcm,
      'Bank Transfer Initiated',
      `₦${naira} to ${input.account_name} (${input.bank_name}) is being processed`,
      { transaction_id: txn.id, type: 'bank_transfer_pending', amount_kobo: amountKobo.toString() },
    );
  }

  return {
    transaction_id:     txn.id,
    transaction_number: transactionNumber(reference),
    reference,
    transaction_date:   txn.created_at.toISOString(),
    status:             'pending',
    payment_method:     paymentMethodLabel('universal_id', 'bank'),
    amount_kobo:        txn.amount.toString(),
    fee_kobo:           txn.fee.toString(),
    net_amount_kobo:    txn.net_amount.toString(),
    narration:          txn.narration,
    sender: {
      user_id:      sender.userId,
      display_name: sender.displayName,
      username:     sender.username,
      wallet_id:    sender.walletId,
    },
    recipient: {
      account_number: `****${input.account_number.slice(-4)}`,
      account_name:   input.verified_account_name,
      bank_name:      input.bank_name,
      bank_code:      input.bank_code,
    },
    estimated_settlement: estimatedSettlement.toISOString(),
    completed_at:         null,
  };
}

// ---------------------------------------------------------------------------
// Shared mapper
// ---------------------------------------------------------------------------

function rowToDetail(row: TransactionRow): TransactionDetail {
  const meta = row.metadata ?? {};
  return {
    id:                  row.id,
    type:                row.type,
    status:              row.status,
    amount_kobo:         row.amount.toString(),
    fee_kobo:            row.fee.toString(),
    net_amount_kobo:     row.net_amount.toString(),
    narration:           row.narration,
    reference:           row.reference,
    source:              (meta['source'] as TransferSource | undefined) ?? null,
    sender_wallet_id:    row.sender_wallet_id,
    receiver_wallet_id:  row.receiver_wallet_id,
    initiator_id:        row.initiator_id,
    metadata:            row.metadata,
    completed_at:        row.completed_at,
    created_at:          row.created_at,
    updated_at:          row.updated_at,
  };
}
