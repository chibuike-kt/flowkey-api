import * as crypto from 'crypto';
import { prisma } from '../../common/utils/prisma';
import { AppError, ErrorCode } from '../../common/errors/AppError';
import { logger } from '../../common/utils/logger';
import { TIER_LIMITS, type KycTier } from '../kyc/kyc.types';
import type { RecipientPreview, TransferResult, TransactionDetail } from './transfers.types';
import { isValidUniversalId, normaliseUniversalId } from '../universal-id/universal-id.service';
import { assertNotLocked, recordFailedAttempt, clearLockout } from '../auth/lockout.service';
import * as argon2 from 'argon2';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

// ---------------------------------------------------------------------------
// Reference generator — FLK-YYYYMMDD-XXXXXX
// ---------------------------------------------------------------------------

function generateReference(): string {
  const now = new Date();
  const date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  const rand = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `FLK-${date}-${rand}`;
}

// ---------------------------------------------------------------------------
// Kobo to BigInt helper
// ---------------------------------------------------------------------------

function toKobo(n: number): bigint {
  return BigInt(Math.round(n));
}

// ---------------------------------------------------------------------------
// POST /transfers/resolve-recipient
// ---------------------------------------------------------------------------

export async function resolveRecipient(
  identifier: string,
  requestingUserId: string,
): Promise<RecipientPreview> {
  const normalised = identifier.trim();

  // Determine lookup strategy: Universal ID or username
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

  if (!user) {
    throw new AppError(ErrorCode.NOT_FOUND, 'Recipient not found.');
  }

  const u = user as {
    id: string;
    username: string;
    display_name: string | null;
    universal_id: string;
    account_status: string;
    wallet: { id: string } | null;
  };

  if (u.account_status !== 'active') {
    throw new AppError(ErrorCode.CONFLICT, 'Recipient account is not active.');
  }

  if (u.id === requestingUserId) {
    throw new AppError(ErrorCode.CONFLICT, 'You cannot transfer to yourself.');
  }

  if (!u.wallet) {
    throw new AppError(ErrorCode.NOT_FOUND, 'Recipient wallet not found.');
  }

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
  senderUserId: string,
  recipientWalletId: string,
  amountKoboRaw: number,
  pin: string,
  narration: string | undefined,
  idempotencyKey: string,
): Promise<TransferResult> {
  const amountKobo = toKobo(amountKoboRaw);

  // 1. Load sender user + auth + wallet
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const sender = await db.user.findUnique({
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
  });

  if (!sender) throw new AppError(ErrorCode.NOT_FOUND, 'Sender not found.');

  const s = sender as {
    kyc_tier: number;
    account_status: string;
    wallet: { id: string } | null;
    user_auth: {
      transaction_pin_hash: string | null;
      transaction_pin_failed_attempts: number;
      transaction_pin_locked_until: Date | null;
      transaction_pin_hard_locked: boolean;
      transaction_pin_lockout_count: number;
    } | null;
  };

  if (s.account_status !== 'active') {
    throw new AppError(ErrorCode.FORBIDDEN, 'Your account is not active.');
  }
  if (!s.wallet) throw new AppError(ErrorCode.NOT_FOUND, 'Sender wallet not found.');
  if (!s.user_auth?.transaction_pin_hash) {
    throw new AppError(ErrorCode.CONFLICT, 'Please set a transaction PIN before making transfers.');
  }
  if (s.wallet.id === recipientWalletId) {
    throw new AppError(ErrorCode.CONFLICT, 'You cannot transfer to yourself.');
  }

  const senderWalletId = s.wallet!.id;
  const auth = s.user_auth;

  // 2. PIN lockout check
  await assertNotLocked(senderUserId, 'pin', async () => ({
    hard_locked: auth.transaction_pin_hard_locked,
    locked_until: auth.transaction_pin_locked_until,
  }));

  // 3. Verify PIN
  const pinValid = await argon2.verify(auth.transaction_pin_hash as string, pin);
  if (!pinValid) {
    const lockResult = await recordFailedAttempt(
      senderUserId,
      'pin',
      auth.transaction_pin_failed_attempts,
      auth.transaction_pin_lockout_count,
    );
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    await db.userAuth.update({
      where: { user_id: senderUserId },
      data: {
        transaction_pin_failed_attempts: lockResult.newFailCount,
        transaction_pin_locked_until: lockResult.lockedUntil,
        transaction_pin_hard_locked: lockResult.hardLocked,
        transaction_pin_lockout_count: lockResult.newLockoutCount,
      },
    });
    throw new AppError(ErrorCode.INVALID_CREDENTIALS, 'Incorrect transaction PIN.');
  }

  // Clear PIN fail counter on success
  await clearLockout(senderUserId, 'pin');
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  await db.userAuth.update({
    where: { user_id: senderUserId },
    data: {
      transaction_pin_failed_attempts: 0,
      transaction_pin_locked_until: null,
      transaction_pin_hard_locked: false,
    },
  });

  // 4. KYC daily limit check
  const tier = s.kyc_tier as KycTier;
  const limit = BigInt(TIER_LIMITS[tier].flowkey_to_flowkey_kobo);

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const todayDebits = await db.ledgerEntry.aggregate({
    where: {
      wallet_id: senderWalletId,
      type: 'debit',
      created_at: { gte: todayStart },
      transaction: { type: 'transfer_internal' },
    },
    _sum: { amount: true },
  });

  const usedToday = (todayDebits as { _sum: { amount: bigint | null } })._sum.amount ?? BigInt(0);

  if (usedToday + amountKobo > limit) {
    throw new AppError(
      ErrorCode.FORBIDDEN,
      `Daily transfer limit of ₦${(Number(limit) / 100).toLocaleString()} reached for your KYC tier. ` +
        `Upgrade to Tier ${tier + 1} for higher limits.`,
    );
  }

  // 5. Execute transfer in a serialisable transaction with pessimistic locking
  const fee = BigInt(0); // No fee on internal transfers
  const netAmount = amountKobo - fee;
  const reference = generateReference();

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const result = await db.$transaction(
    async (tx: typeof db) => {
      // Lock both wallets — always in wallet_id order to prevent deadlocks
      const [wA, wB] = [senderWalletId, recipientWalletId].sort();
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      await tx.$queryRaw`SELECT id FROM wallets WHERE id IN (${wA}::uuid, ${wB}::uuid) FOR UPDATE`;

      // Read current balance (credits - debits)
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      const [creditAgg, debitAgg] = await Promise.all([
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
        tx.ledgerEntry.aggregate({
          where: { wallet_id: senderWalletId, type: 'credit' },
          _sum: { amount: true },
        }),
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
        tx.ledgerEntry.aggregate({
          where: { wallet_id: senderWalletId, type: 'debit' },
          _sum: { amount: true },
        }),
      ]);

      const totalCredit =
        (creditAgg as { _sum: { amount: bigint | null } })._sum.amount ?? BigInt(0);
      const totalDebit = (debitAgg as { _sum: { amount: bigint | null } })._sum.amount ?? BigInt(0);
      const balance = totalCredit - totalDebit;

      if (balance < amountKobo) {
        throw new AppError(
          ErrorCode.CONFLICT,
          `Insufficient balance. Available: ₦${(Number(balance) / 100).toLocaleString()}.`,
        );
      }

      // Create transaction record
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      const txn = await tx.transaction.create({
        data: {
          type: 'transfer_internal',
          status: 'completed',
          amount: amountKobo,
          fee,
          net_amount: netAmount,
          narration: narration ?? null,
          reference,
          idempotency_key: idempotencyKey,
          initiator_id: senderUserId,
          initiator_type: 'user',
          sender_wallet_id: senderWalletId,
          receiver_wallet_id: recipientWalletId,
          completed_at: new Date(),
        },
      });

      const txnId = (txn as { id: string }).id;

      // Double-entry ledger: debit sender, credit receiver
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      await tx.ledgerEntry.createMany({
        data: [
          { wallet_id: senderWalletId, transaction_id: txnId, type: 'debit', amount: amountKobo },
          {
            wallet_id: recipientWalletId,
            transaction_id: txnId,
            type: 'credit',
            amount: netAmount,
          },
        ],
      });

      // Audit log
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      await tx.auditLog.create({
        data: {
          actor_id: senderUserId,
          actor_type: 'user',
          action: 'transfer.internal',
          target_type: 'transaction',
          target_id: txnId,
          previous_hash: 'CHAINED',
          metadata: {
            amount_kobo: amountKobo.toString(),
            fee_kobo: fee.toString(),
            sender_wallet: senderWalletId,
            receiver_wallet: recipientWalletId,
            reference,
          },
        },
      });

      return txn as {
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
    transaction_id: result.id,
    sender_wallet_id: senderWalletId,
    receiver_wallet_id: recipientWalletId,
    amount_kobo: amountKobo.toString(),
    reference,
  });

  return {
    transaction_id: result.id,
    reference: result.reference,
    amount_kobo: result.amount.toString(),
    fee_kobo: result.fee.toString(),
    net_amount_kobo: result.net_amount.toString(),
    status: 'completed',
    sender_wallet_id: result.sender_wallet_id ?? senderWalletId,
    receiver_wallet_id: result.receiver_wallet_id ?? recipientWalletId,
    narration: result.narration,
    created_at: result.created_at,
  };
}

// ---------------------------------------------------------------------------
// GET /transfers/:id
// ---------------------------------------------------------------------------

export async function getTransactionById(
  transactionId: string,
  requestingUserId: string,
): Promise<TransactionDetail> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const txn = await db.transaction.findUnique({
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
      sender_wallet_id: true,
      receiver_wallet_id: true,
      initiator_id: true,
      metadata: true,
      completed_at: true,
      created_at: true,
      updated_at: true,
      sender_wallet: { select: { user_id: true } },
      receiver_wallet: { select: { user_id: true } },
    },
  });

  if (!txn) throw new AppError(ErrorCode.NOT_FOUND, 'Transaction not found.');

  const t = txn as {
    id: string;
    type: string;
    status: string;
    amount: bigint;
    fee: bigint;
    net_amount: bigint;
    narration: string | null;
    reference: string;
    sender_wallet_id: string | null;
    receiver_wallet_id: string | null;
    initiator_id: string;
    metadata: Record<string, unknown> | null;
    completed_at: Date | null;
    created_at: Date;
    updated_at: Date;
    sender_wallet: { user_id: string } | null;
    receiver_wallet: { user_id: string } | null;
  };

  // Authorization: only participants can view the transaction
  const isSender = t.sender_wallet?.user_id === requestingUserId;
  const isReceiver = t.receiver_wallet?.user_id === requestingUserId;
  const isInitiator = t.initiator_id === requestingUserId;

  if (!isSender && !isReceiver && !isInitiator) {
    throw new AppError(ErrorCode.FORBIDDEN, 'You do not have access to this transaction.');
  }

  return {
    id: t.id,
    type: t.type,
    status: t.status,
    amount_kobo: t.amount.toString(),
    fee_kobo: t.fee.toString(),
    net_amount_kobo: t.net_amount.toString(),
    narration: t.narration,
    reference: t.reference,
    sender_wallet_id: t.sender_wallet_id,
    receiver_wallet_id: t.receiver_wallet_id,
    initiator_id: t.initiator_id,
    metadata: t.metadata,
    completed_at: t.completed_at,
    created_at: t.created_at,
    updated_at: t.updated_at,
  };
}
