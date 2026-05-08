import * as crypto from 'crypto';
import { prisma } from '../../common/utils/prisma';
import { AppError, ErrorCode } from '../../common/errors/AppError';
import { logger } from '../../common/utils/logger';
import { TIER_LIMITS, type KycTier } from '../kyc/kyc.types';
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
} from './transfers.types';
import type {
  InternalTransferInput,
  BankTransferInput,
  ListTransfersInput,
} from './transfers.schema';
import * as argon2 from 'argon2';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateReference(): string {
  const d = new Date();
  const date = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const rand = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `FLK-${date}-${rand}`;
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
  transaction_pin_hash: string | null;
  transaction_pin_failed_attempts: number;
  transaction_pin_locked_until: Date | null;
  transaction_pin_hard_locked: boolean;
  transaction_pin_lockout_count: number;
}

interface SenderRow {
  id: string;
  kyc_tier: number;
  account_status: string;
  wallet: { id: string } | null;
  user_auth: UserAuthRow | null;
}

interface TransactionRow {
  id: string;
  type: string;
  status: string;
  amount: bigint;
  fee: bigint;
  net_amount: bigint;
  narration: string | null;
  reference: string;
  metadata: Record<string, unknown> | null;
  sender_wallet_id: string | null;
  receiver_wallet_id: string | null;
  initiator_id: string;
  completed_at: Date | null;
  created_at: Date;
  updated_at: Date;
  sender_wallet: { user_id: string } | null;
  receiver_wallet: { user_id: string } | null;
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
  userId: string,
  pinHash: string,
  pin: string,
  failCount: number,
  lockoutCount: number,
  lockedUntil: Date | null,
  hardLocked: boolean,
): Promise<void> {
  await assertNotLocked(userId, 'pin', async () => ({
    hard_locked: hardLocked,
    locked_until: lockedUntil,
  }));

  const valid = await argon2.verify(pinHash, pin);
  if (!valid) {
    const lock = await recordFailedAttempt(userId, 'pin', failCount, lockoutCount);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    await db.userAuth.update({
      where: { user_id: userId },
      data: {
        transaction_pin_failed_attempts: lock.newFailCount,
        transaction_pin_locked_until: lock.lockedUntil,
        transaction_pin_hard_locked: lock.hardLocked,
        transaction_pin_lockout_count: lock.newLockoutCount,
      },
    });
    throw new AppError(ErrorCode.INVALID_CREDENTIALS, 'Incorrect transaction PIN.');
  }

  await clearLockout(userId, 'pin');
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  await db.userAuth.update({
    where: { user_id: userId },
    data: {
      transaction_pin_failed_attempts: 0,
      transaction_pin_locked_until: null,
      transaction_pin_hard_locked: false,
    },
  });
}

async function checkKycDailyLimit(
  walletId: string,
  amountKobo: bigint,
  txType: string,
  limitKobo: bigint,
  limitLabel: string,
): Promise<void> {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const agg = await db.ledgerEntry.aggregate({
    where: {
      wallet_id: walletId,
      type: 'debit',
      created_at: { gte: todayStart },
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
    tx.ledgerEntry.aggregate({
      where: { wallet_id: walletId, type: 'credit' },
      _sum: { amount: true },
    }),
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    tx.ledgerEntry.aggregate({
      where: { wallet_id: walletId, type: 'debit' },
      _sum: { amount: true },
    }),
  ]);
  return (
    bigintSum(credits as { _sum: { amount: bigint | null } }) -
    bigintSum(debits as { _sum: { amount: bigint | null } })
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
  identifier: string,
  requestingUserId: string,
): Promise<RecipientPreview> {
  const normalised = identifier.trim();
  const isUid = isValidUniversalId(normalised);

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const user = await db.user.findFirst({
    where: isUid
      ? { universal_id: normaliseUniversalId(normalised), deleted_at: null }
      : { username: normalised.toLowerCase(), deleted_at: null },
    select: {
      id: true,
      username: true,
      display_name: true,
      universal_id: true,
      account_status: true,
      wallet: { select: { id: true } },
    },
  });

  if (!user) throw new AppError(ErrorCode.NOT_FOUND, 'Recipient not found.');

  const u = user as {
    id: string;
    username: string;
    display_name: string | null;
    universal_id: string;
    account_status: string;
    wallet: { id: string } | null;
  };

  if (u.account_status !== 'active')
    throw new AppError(ErrorCode.CONFLICT, 'Recipient account is not active.');
  if (u.id === requestingUserId)
    throw new AppError(ErrorCode.CONFLICT, 'You cannot transfer to yourself.');
  if (!u.wallet) throw new AppError(ErrorCode.NOT_FOUND, 'Recipient wallet not found.');

  return {
    user_id: u.id,
    username: u.username,
    display_name: u.display_name,
    universal_id: u.universal_id,
    wallet_id: u.wallet.id,
  };
}

// ---------------------------------------------------------------------------
// POST /transfers/internal
// ---------------------------------------------------------------------------

export async function executeInternalTransfer(
  deviceUserId: string,
  input: InternalTransferInput,
  idempotencyKey: string,
): Promise<InternalTransferResult> {
  const amountKobo = toKobo(input.amount_kobo);
  const source = input.source as TransferSource;

  // ── 1. Load sender (UID owner or device user) ─────────────────────────────
  let senderUserId: string;
  let senderWalletId: string;
  let senderAuth: UserAuthRow;
  let senderKycTier: number;
  let uidDeviceMismatch = false;

  if (source === 'universal_id' && input.uid_identifier) {
    const uid = normaliseUniversalId(input.uid_identifier);

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const owner = (await db.user.findFirst({
      where: { universal_id: uid, deleted_at: null },
      select: {
        id: true,
        kyc_tier: true,
        account_status: true,
        wallet: { select: { id: true } },
        user_auth: {
          select: {
            transaction_pin_hash: true,
            transaction_pin_failed_attempts: true,
            transaction_pin_locked_until: true,
            transaction_pin_hard_locked: true,
            transaction_pin_lockout_count: true,
          },
        },
      },
    })) as SenderRow | null;

    if (!owner) throw new AppError(ErrorCode.NOT_FOUND, 'Universal ID not found.');
    if (!owner.wallet) throw new AppError(ErrorCode.NOT_FOUND, 'Your wallet not found.');
    if (!owner.user_auth?.transaction_pin_hash)
      throw new AppError(ErrorCode.CONFLICT, 'Please set a transaction PIN first.');

    assertActive(owner.account_status, 'Your');

    senderUserId = owner.id;
    senderWalletId = owner.wallet.id;
    senderAuth = owner.user_auth;
    senderKycTier = owner.kyc_tier;
    uidDeviceMismatch = owner.id !== deviceUserId;
  } else {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const sender = (await db.user.findUnique({
      where: { id: deviceUserId },
      select: {
        kyc_tier: true,
        account_status: true,
        wallet: { select: { id: true } },
        user_auth: {
          select: {
            transaction_pin_hash: true,
            transaction_pin_failed_attempts: true,
            transaction_pin_locked_until: true,
            transaction_pin_hard_locked: true,
            transaction_pin_lockout_count: true,
          },
        },
      },
    })) as Omit<SenderRow, 'id'> | null;

    if (!sender) throw new AppError(ErrorCode.NOT_FOUND, 'Sender not found.');
    if (!sender.wallet) throw new AppError(ErrorCode.NOT_FOUND, 'Your wallet not found.');
    if (!sender.user_auth?.transaction_pin_hash)
      throw new AppError(ErrorCode.CONFLICT, 'Please set a transaction PIN first.');

    assertActive(sender.account_status, 'Your');

    senderUserId = deviceUserId;
    senderWalletId = sender.wallet.id;
    senderAuth = sender.user_auth;
    senderKycTier = sender.kyc_tier;
  }

  // ── 2. Guards ──────────────────────────────────────────────────────────────
  if (senderWalletId === input.recipient_wallet_id) {
    throw new AppError(ErrorCode.CONFLICT, 'You cannot transfer to yourself.');
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const recipientWallet = (await db.wallet.findUnique({
    where: { id: input.recipient_wallet_id },
    select: { id: true, user: { select: { account_status: true } } },
  })) as { id: string; user: { account_status: string } | null } | null;

  if (!recipientWallet) throw new AppError(ErrorCode.NOT_FOUND, 'Recipient wallet not found.');
  if (recipientWallet.user?.account_status !== 'active')
    throw new AppError(ErrorCode.CONFLICT, 'Recipient account is not active.');

  // ── 3. Fraud + PIN + KYC ──────────────────────────────────────────────────
  await checkInternalTransferFraud(senderWalletId, amountKobo, source, input.uid_identifier);

  await verifyPin(
    senderUserId,
    senderAuth.transaction_pin_hash!,
    input.pin,
    senderAuth.transaction_pin_failed_attempts,
    senderAuth.transaction_pin_lockout_count,
    senderAuth.transaction_pin_locked_until,
    senderAuth.transaction_pin_hard_locked,
  );

  const tier = senderKycTier as KycTier;
  const dailyLimit = BigInt(TIER_LIMITS[tier].flowkey_to_flowkey_kobo);
  await checkKycDailyLimit(senderWalletId, amountKobo, 'transfer_internal', dailyLimit, 'transfer');

  // ── 4. Execute ─────────────────────────────────────────────────────────────
  const fee = BigInt(0);
  const netAmount = amountKobo - fee;
  const reference = generateReference();

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const txn = await db.$transaction(
    async (tx: typeof db) => {
      const [wA, wB] = [senderWalletId, input.recipient_wallet_id].sort();
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      await tx.$queryRaw`SELECT id FROM wallets WHERE id IN (${wA}::uuid, ${wB}::uuid) FOR UPDATE`;

      assertSufficientBalance(await getBalanceInLock(tx, senderWalletId), amountKobo);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      const row = await tx.transaction.create({
        data: {
          type: 'transfer_internal',
          status: 'completed',
          amount: amountKobo,
          fee,
          net_amount: netAmount,
          narration: input.narration ?? null,
          reference,
          idempotency_key: idempotencyKey,
          initiator_id: deviceUserId,
          initiator_type: 'user',
          sender_wallet_id: senderWalletId,
          receiver_wallet_id: input.recipient_wallet_id,
          completed_at: new Date(),
          metadata: {
            source,
            device_id: input.device_id ?? null,
            uid_presented: source === 'universal_id' ? input.uid_identifier : null,
            uid_device_mismatch: uidDeviceMismatch,
            qr_token: input.qr_token ?? null,
          },
        },
      });

      const txnId = (row as { id: string }).id;

      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      await tx.ledgerEntry.createMany({
        data: [
          { wallet_id: senderWalletId, transaction_id: txnId, type: 'debit', amount: amountKobo },
          {
            wallet_id: input.recipient_wallet_id,
            transaction_id: txnId,
            type: 'credit',
            amount: netAmount,
          },
        ],
      });

      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      await tx.receipt.create({
        data: { transaction_id: txnId, public_token: crypto.randomUUID() },
      });

      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      await tx.auditLog.create({
        data: {
          actor_id: deviceUserId,
          actor_type: 'user',
          action: 'transfer.internal',
          target_type: 'transaction',
          target_id: txnId,
          previous_hash: 'CHAINED',
          metadata: {
            sender_user_id: senderUserId,
            sender_wallet_id: senderWalletId,
            receiver_wallet_id: input.recipient_wallet_id,
            amount_kobo: amountKobo.toString(),
            reference,
            source,
            uid_device_mismatch: uidDeviceMismatch,
            device_id: input.device_id ?? null,
          },
        },
      });

      return row as {
        id: string;
        amount: bigint;
        fee: bigint;
        net_amount: bigint;
        narration: string | null;
        reference: string;
        sender_wallet_id: string;
        receiver_wallet_id: string;
        created_at: Date;
      };
    },
    { isolationLevel: 'Serializable' },
  );

  logger.info('Internal transfer completed', {
    transaction_id: txn.id,
    reference,
    source,
    amount_kobo: amountKobo.toString(),
    uid_device_mismatch: uidDeviceMismatch,
  });

  return {
    transaction_id: txn.id,
    reference: txn.reference,
    status: 'completed',
    amount_kobo: txn.amount.toString(),
    fee_kobo: txn.fee.toString(),
    net_amount_kobo: txn.net_amount.toString(),
    narration: txn.narration,
    source,
    sender_wallet_id: senderWalletId,
    receiver_wallet_id: input.recipient_wallet_id,
    ...(uidDeviceMismatch && { uid_device_mismatch: true }),
    created_at: txn.created_at,
  };
}

// ---------------------------------------------------------------------------
// POST /transfers/bank
// ---------------------------------------------------------------------------

export async function initiateBankTransfer(
  senderUserId: string,
  input: BankTransferInput,
  idempotencyKey: string,
): Promise<BankTransferResult> {
  const amountKobo = toKobo(input.amount_kobo);

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const sender = (await db.user.findUnique({
    where: { id: senderUserId },
    select: {
      kyc_tier: true,
      account_status: true,
      wallet: { select: { id: true } },
      user_auth: {
        select: {
          transaction_pin_hash: true,
          transaction_pin_failed_attempts: true,
          transaction_pin_locked_until: true,
          transaction_pin_hard_locked: true,
          transaction_pin_lockout_count: true,
        },
      },
    },
  })) as Omit<SenderRow, 'id'> | null;

  if (!sender) throw new AppError(ErrorCode.NOT_FOUND, 'Sender not found.');
  if (!sender.wallet) throw new AppError(ErrorCode.NOT_FOUND, 'Your wallet not found.');
  if (!sender.user_auth?.transaction_pin_hash)
    throw new AppError(ErrorCode.CONFLICT, 'Please set a transaction PIN first.');

  assertActive(sender.account_status, 'Your');

  const senderWalletId = sender.wallet.id;
  const auth = sender.user_auth;
  const tier = sender.kyc_tier as KycTier;

  await checkBankTransferFraud(senderWalletId, amountKobo);

  const dailyLimit = BigInt(TIER_LIMITS[tier].flowkey_to_bank_kobo);
  await checkKycDailyLimit(
    senderWalletId,
    amountKobo,
    'transfer_bank',
    dailyLimit,
    'bank transfer',
  );

  await verifyPin(
    senderUserId,
    auth.transaction_pin_hash!,
    input.pin,
    auth.transaction_pin_failed_attempts,
    auth.transaction_pin_lockout_count,
    auth.transaction_pin_locked_until,
    auth.transaction_pin_hard_locked,
  );

  const fee = tier === 1 ? BigInt(5_000) : BigInt(0); // ₦50 for Tier 1
  const netAmount = amountKobo - fee;
  const reference = generateReference();
  const estimatedSettlement = new Date(Date.now() + 5 * 60 * 1000);

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const txn = await db.$transaction(
    async (tx: typeof db) => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      await tx.$queryRaw`SELECT id FROM wallets WHERE id = ${senderWalletId}::uuid FOR UPDATE`;

      assertSufficientBalance(await getBalanceInLock(tx, senderWalletId), amountKobo);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      const row = await tx.transaction.create({
        data: {
          type: 'transfer_bank',
          status: 'pending',
          amount: amountKobo,
          fee,
          net_amount: netAmount,
          narration: input.narration ?? null,
          reference,
          idempotency_key: idempotencyKey,
          initiator_id: senderUserId,
          initiator_type: 'user',
          sender_wallet_id: senderWalletId,
          receiver_wallet_id: null,
          metadata: {
            bank_code: input.bank_code,
            account_number_last4: input.account_number.slice(-4),
            account_name: input.account_name,
            bank_name: input.bank_name,
            verified_account_name: input.verified_account_name,
            device_id: input.device_id ?? null,
            estimated_settlement: estimatedSettlement.toISOString(),
          },
        },
      });

      const txnId = (row as { id: string }).id;

      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      await tx.ledgerEntry.create({
        data: {
          wallet_id: senderWalletId,
          transaction_id: txnId,
          type: 'debit',
          amount: amountKobo,
        },
      });

      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      await tx.receipt.create({
        data: { transaction_id: txnId, public_token: crypto.randomUUID() },
      });

      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      await tx.auditLog.create({
        data: {
          actor_id: senderUserId,
          actor_type: 'user',
          action: 'transfer.bank.initiated',
          target_type: 'transaction',
          target_id: txnId,
          previous_hash: 'CHAINED',
          metadata: {
            sender_wallet_id: senderWalletId,
            amount_kobo: amountKobo.toString(),
            fee_kobo: fee.toString(),
            bank_code: input.bank_code,
            account_last4: input.account_number.slice(-4),
            reference,
          },
        },
      });

      return row as {
        id: string;
        amount: bigint;
        fee: bigint;
        net_amount: bigint;
        narration: string | null;
        created_at: Date;
      };
    },
    { isolationLevel: 'Serializable' },
  );

  await bankTransferQueue.add(
    'process_bank_transfer',
    {
      transactionId: txn.id,
      reference,
      senderWalletId,
      amountKobo: amountKobo.toString(),
      bankCode: input.bank_code,
      accountNumber: input.account_number,
      accountName: input.account_name,
      narration: input.narration ?? null,
      attemptNumber: 1,
    },
    {
      jobId: `bank-transfer:${txn.id}`,
      delay: 2000,
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    },
  );

  logger.info('Bank transfer initiated', {
    transaction_id: txn.id,
    reference,
    amount_kobo: amountKobo.toString(),
    bank_code: input.bank_code,
    account_last4: input.account_number.slice(-4),
  });

  return {
    transaction_id: txn.id,
    reference,
    status: 'pending',
    amount_kobo: txn.amount.toString(),
    fee_kobo: txn.fee.toString(),
    net_amount_kobo: txn.net_amount.toString(),
    narration: txn.narration,
    recipient_account: `****${input.account_number.slice(-4)}`,
    recipient_bank_name: input.bank_name,
    recipient_name: input.verified_account_name,
    estimated_settlement: estimatedSettlement.toISOString(),
    sender_wallet_id: senderWalletId,
    created_at: txn.created_at,
    completed_at: null,
  };
}

// ---------------------------------------------------------------------------
// Auto-reversal — called by BullMQ worker on bank transfer failure
// ---------------------------------------------------------------------------

export async function reverseBankTransfer(
  originalTransactionId: string,
  senderWalletId: string,
  amountKobo: bigint,
  failureReason: string,
): Promise<void> {
  const reversalReference = `REV-${generateReference()}`;

  await db.$transaction(
    async (tx: typeof db) => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      await tx.$queryRaw`SELECT id FROM wallets WHERE id = ${senderWalletId}::uuid FOR UPDATE`;

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      const reversalTxn = await tx.transaction.create({
        data: {
          type: 'reversal',
          status: 'completed',
          amount: amountKobo,
          fee: BigInt(0),
          net_amount: amountKobo,
          narration: `Reversal: bank transfer failed — ${failureReason}`,
          reference: reversalReference,
          idempotency_key: crypto.randomUUID(),
          initiator_id: '00000000-0000-0000-0000-000000000000',
          initiator_type: 'system',
          sender_wallet_id: null,
          receiver_wallet_id: senderWalletId,
          completed_at: new Date(),
          metadata: {
            original_transaction_id: originalTransactionId,
            failure_reason: failureReason,
          },
        },
      });

      const reversalTxnId = (reversalTxn as { id: string }).id;

      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      await tx.ledgerEntry.create({
        data: {
          wallet_id: senderWalletId,
          transaction_id: reversalTxnId,
          type: 'credit',
          amount: amountKobo,
        },
      });

      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      await tx.transaction.update({
        where: { id: originalTransactionId },
        data: { status: 'reversed' },
      });

      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      await tx.reversal.create({
        data: {
          original_transaction_id: originalTransactionId,
          reversal_transaction_id: reversalTxnId,
          admin_id: '00000000-0000-0000-0000-000000000000',
          reason_code: 'bank_transfer_failed',
          note: failureReason,
        },
      });

      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      await tx.auditLog.create({
        data: {
          actor_id: null,
          actor_type: 'system',
          action: 'transfer.bank.reversed',
          target_type: 'transaction',
          target_id: originalTransactionId,
          previous_hash: 'CHAINED',
          metadata: {
            reversal_transaction_id: reversalTxnId,
            sender_wallet_id: senderWalletId,
            amount_kobo: amountKobo.toString(),
            failure_reason: failureReason,
            reversal_reference: reversalReference,
          },
        },
      });
    },
    { isolationLevel: 'Serializable' },
  );

  logger.info('Bank transfer reversed', {
    original_transaction_id: originalTransactionId,
    reversal_reference: reversalReference,
    amount_kobo: amountKobo.toString(),
  });
}

// ---------------------------------------------------------------------------
// GET /transfers/:id
// ---------------------------------------------------------------------------

export async function getTransactionById(
  transactionId: string,
  requestingUserId: string,
): Promise<TransactionDetail> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const row = (await db.transaction.findUnique({
    where: { id: transactionId },
    select: {
      id: true,
      type: true,
      status: true,
      amount: true,
      fee: true,
      net_amount: true,
      narration: true,
      reference: true,
      metadata: true,
      sender_wallet_id: true,
      receiver_wallet_id: true,
      initiator_id: true,
      completed_at: true,
      created_at: true,
      updated_at: true,
      sender_wallet: { select: { user_id: true } },
      receiver_wallet: { select: { user_id: true } },
    },
  })) as TransactionRow | null;

  if (!row) throw new AppError(ErrorCode.NOT_FOUND, 'Transaction not found.');

  const isSender = row.sender_wallet?.user_id === requestingUserId;
  const isReceiver = row.receiver_wallet?.user_id === requestingUserId;
  const isInitiator = row.initiator_id === requestingUserId;

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
  input: ListTransfersInput,
): Promise<{ items: TransactionDetail[]; next_cursor: string | null }> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const wallet = (await db.wallet.findUnique({
    where: { user_id: userId },
    select: { id: true },
  })) as { id: string } | null;

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
    const pivot = (await db.transaction.findUnique({
      where: { id: input.cursor },
      select: { created_at: true },
    })) as { created_at: Date } | null;
    if (pivot) where['created_at'] = { lt: pivot.created_at };
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const rows = (await db.transaction.findMany({
    where,
    orderBy: { created_at: 'desc' },
    take: input.limit + 1,
    select: {
      id: true,
      type: true,
      status: true,
      amount: true,
      fee: true,
      net_amount: true,
      narration: true,
      reference: true,
      metadata: true,
      sender_wallet_id: true,
      receiver_wallet_id: true,
      initiator_id: true,
      completed_at: true,
      created_at: true,
      updated_at: true,
      sender_wallet: { select: { user_id: true } },
      receiver_wallet: { select: { user_id: true } },
    },
  })) as TransactionRow[];

  const items = rows.slice(0, input.limit).map(rowToDetail);
  const nextCursor = rows.length > input.limit ? (items[items.length - 1]?.id ?? null) : null;

  return { items, next_cursor: nextCursor };
}

// ---------------------------------------------------------------------------
// POST /transfers/:id/retry
// ---------------------------------------------------------------------------

export async function retryBankTransfer(
  transactionId: string,
  requestingUserId: string,
  pin: string,
): Promise<BankTransferResult> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const row = (await db.transaction.findUnique({
    where: { id: transactionId },
    select: {
      id: true,
      type: true,
      status: true,
      amount: true,
      fee: true,
      net_amount: true,
      narration: true,
      reference: true,
      metadata: true,
      sender_wallet_id: true,
      created_at: true,
      completed_at: true,
      sender_wallet: { select: { user_id: true } },
    },
  })) as Pick<
    TransactionRow,
    | 'id'
    | 'type'
    | 'status'
    | 'amount'
    | 'fee'
    | 'net_amount'
    | 'narration'
    | 'reference'
    | 'metadata'
    | 'sender_wallet_id'
    | 'created_at'
    | 'completed_at'
    | 'sender_wallet'
  > | null;

  if (!row) throw new AppError(ErrorCode.NOT_FOUND, 'Transaction not found.');

  if (row.sender_wallet?.user_id !== requestingUserId)
    throw new AppError(ErrorCode.FORBIDDEN, 'You can only retry your own transfers.');
  if (row.type !== 'transfer_bank')
    throw new AppError(ErrorCode.CONFLICT, 'Only bank transfers can be retried.');
  if (row.status !== 'failed')
    throw new AppError(ErrorCode.CONFLICT, `Transfer cannot be retried in status: ${row.status}.`);

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const auth = (await db.userAuth.findUnique({
    where: { user_id: requestingUserId },
    select: {
      transaction_pin_hash: true,
      transaction_pin_failed_attempts: true,
      transaction_pin_locked_until: true,
      transaction_pin_hard_locked: true,
      transaction_pin_lockout_count: true,
    },
  })) as UserAuthRow | null;

  if (!auth?.transaction_pin_hash)
    throw new AppError(ErrorCode.CONFLICT, 'Transaction PIN not set.');

  await verifyPin(
    requestingUserId,
    auth.transaction_pin_hash,
    pin,
    auth.transaction_pin_failed_attempts,
    auth.transaction_pin_lockout_count,
    auth.transaction_pin_locked_until,
    auth.transaction_pin_hard_locked,
  );

  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  await db.transaction.update({ where: { id: transactionId }, data: { status: 'pending' } });

  const meta = row.metadata ?? {};
  const prevAttempts = (meta['attempt_number'] as number | undefined) ?? 1;

  await bankTransferQueue.add(
    'process_bank_transfer',
    {
      transactionId,
      reference: row.reference,
      senderWalletId: row.sender_wallet_id!,
      amountKobo: row.amount.toString(),
      bankCode: meta['bank_code'] as string,
      accountNumber: `000000${meta['account_number_last4'] as string}`,
      accountName: meta['account_name'] as string,
      narration: row.narration,
      attemptNumber: prevAttempts + 1,
    },
    {
      jobId: `bank-transfer:retry:${transactionId}:${Date.now()}`,
      delay: 1000,
      attempts: 2,
      backoff: { type: 'exponential', delay: 5000 },
    },
  );

  logger.info('Bank transfer retry queued', {
    transaction_id: transactionId,
    attempt: prevAttempts + 1,
  });

  return {
    transaction_id: row.id,
    reference: row.reference,
    status: 'pending',
    amount_kobo: row.amount.toString(),
    fee_kobo: row.fee.toString(),
    net_amount_kobo: row.net_amount.toString(),
    narration: row.narration,
    recipient_account: `****${(meta['account_number_last4'] as string | undefined) ?? '????'}`,
    recipient_bank_name: (meta['bank_name'] as string | undefined) ?? '',
    recipient_name: (meta['verified_account_name'] as string | undefined) ?? '',
    estimated_settlement: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    sender_wallet_id: row.sender_wallet_id!,
    created_at: row.created_at,
    completed_at: null,
  };
}

// ---------------------------------------------------------------------------
// Shared mapper
// ---------------------------------------------------------------------------

function rowToDetail(row: TransactionRow): TransactionDetail {
  const meta = row.metadata ?? {};
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    amount_kobo: row.amount.toString(),
    fee_kobo: row.fee.toString(),
    net_amount_kobo: row.net_amount.toString(),
    narration: row.narration,
    reference: row.reference,
    source: (meta['source'] as TransferSource | undefined) ?? null,
    sender_wallet_id: row.sender_wallet_id,
    receiver_wallet_id: row.receiver_wallet_id,
    initiator_id: row.initiator_id,
    metadata: row.metadata,
    completed_at: row.completed_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
