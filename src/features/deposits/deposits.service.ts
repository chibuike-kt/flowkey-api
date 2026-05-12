import * as crypto from 'crypto';
import { prisma } from '../../common/utils/prisma';
import { AppError, ErrorCode } from '../../common/errors/AppError';
import { logger } from '../../common/utils/logger';
import { assertNotLocked, recordFailedAttempt, clearLockout } from '../auth/lockout.service';
import {
  provisionVirtualAccount,
  verifyPaystackAuthorization,
} from './deposit-processor';
import { cardDepositQueue } from '../../queues/index';
import type {
  VirtualAccount,
  SavedCard,
  DepositRecord,
  DepositChannel,
  DepositStatus,
} from './deposits.types';
import type { AddCardInput, CardDepositInput, ListDepositsInput } from './deposits.schema';
import * as argon2 from 'argon2';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

function generateDepositReference(): string {
  const d = new Date();
  const date = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const rand = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `DEP-${date}-${rand}`;
}

function toKobo(n: number): bigint {
  return BigInt(Math.round(n));
}

// ---------------------------------------------------------------------------
// Virtual account — provision
// ---------------------------------------------------------------------------

export async function provisionUserVirtualAccount(userId: string): Promise<VirtualAccount> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const wallet = (await db.wallet.findUnique({
    where: { user_id: userId },
    select: {
      id: true,
      virtual_account: true,
    },
  })) as { id: string; virtual_account: VirtualAccountRow | null } | null;

  if (!wallet) throw new AppError(ErrorCode.NOT_FOUND, 'Wallet not found.');

  if (wallet.virtual_account) {
    return toVirtualAccountRecord(wallet.virtual_account, wallet.id);
  }

  // Load display name for the account name
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const user = (await db.user.findUnique({
    where: { id: userId },
    select: { display_name: true, username: true },
  })) as { display_name: string | null; username: string } | null;

  const accountName = user?.display_name ?? user?.username ?? 'FlowKey User';

  const result = await provisionVirtualAccount({ userId, accountName });

  if (!result.success) {
    throw new AppError(
      ErrorCode.EXTERNAL_SERVICE_ERROR,
      'Could not provision virtual account. Please try again.',
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const record = (await db.virtualAccount.create({
    data: {
      wallet_id: wallet.id,
      account_number: result.account_number,
      account_name: result.account_name,
      bank_name: result.bank_name,
      bank_code: result.bank_code,
      provider: 'providus',
      provider_ref: result.provider_ref,
      is_active: true,
    },
  })) as VirtualAccountRow;

  logger.info('Virtual account provisioned', {
    user_id: userId,
    wallet_id: wallet.id,
    bank: result.bank_name,
    last4: result.account_number.slice(-4),
  });

  return toVirtualAccountRecord(record, wallet.id);
}

// ---------------------------------------------------------------------------
// Virtual account — fetch
// ---------------------------------------------------------------------------

export async function getUserVirtualAccount(userId: string): Promise<VirtualAccount | null> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const wallet = (await db.wallet.findUnique({
    where: { user_id: userId },
    select: { id: true, virtual_account: true },
  })) as { id: string; virtual_account: VirtualAccountRow | null } | null;

  if (!wallet?.virtual_account) return null;
  return toVirtualAccountRecord(wallet.virtual_account, wallet.id);
}

// ---------------------------------------------------------------------------
// Cards — add
// ---------------------------------------------------------------------------

export async function addCard(userId: string, input: AddCardInput): Promise<SavedCard> {
  // Verify authorization code is genuine with Paystack
  const verification = await verifyPaystackAuthorization({
    authorization_code: input.authorization_code,
    last4: input.last4,
    card_type: input.card_type,
    bank: input.bank,
    expiry_month: input.expiry_month,
    expiry_year: input.expiry_year,
  });

  if (!verification.success || !verification.reusable) {
    throw new AppError(
      ErrorCode.VALIDATION_ERROR,
      'Card could not be verified. Please try again or use a different card.',
    );
  }

  // Check if this card (same last4 + expiry) is already saved for this user
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const existing = (await db.savedCard.findFirst({
    where: {
      user_id: userId,
      last4: input.last4,
      expiry_month: input.expiry_month,
      expiry_year: input.expiry_year,
    },
    select: { id: true },
  })) as { id: string } | null;

  if (existing) {
    throw new AppError(ErrorCode.CONFLICT, 'This card has already been added to your account.');
  }

  // If set_as_default, un-default existing cards first
  if (input.set_as_default) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    await db.savedCard.updateMany({
      where: { user_id: userId, is_default: true },
      data: { is_default: false },
    });
  }

  // Count existing cards — first card added is always default
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const cardCount = (await db.savedCard.count({ where: { user_id: userId } })) as number;
  const isDefault = input.set_as_default || cardCount === 0;

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const card = (await db.savedCard.create({
    data: {
      user_id: userId,
      authorization_code: verification.authorization_code, // encrypted at rest via DB column encryption (Phase 16)
      last4: verification.last4,
      card_type: verification.card_type,
      bank: verification.bank,
      expiry_month: verification.expiry_month,
      expiry_year: verification.expiry_year,
      is_default: isDefault,
    },
  })) as SavedCardRow;

  logger.info('Card added', {
    user_id: userId,
    last4: card.last4,
    card_type: card.card_type,
    bank: card.bank,
  });

  return toSavedCardRecord(card);
}

// ---------------------------------------------------------------------------
// Cards — list
// ---------------------------------------------------------------------------

export async function listCards(userId: string): Promise<SavedCard[]> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const rows = (await db.savedCard.findMany({
    where: { user_id: userId },
    orderBy: [{ is_default: 'desc' }, { created_at: 'desc' }],
    select: {
      id: true,
      user_id: true,
      last4: true,
      card_type: true,
      bank: true,
      expiry_month: true,
      expiry_year: true,
      is_default: true,
      created_at: true,
      // authorization_code intentionally excluded from list response
    },
  })) as SavedCardRow[];

  return rows.map(toSavedCardRecord);
}

// ---------------------------------------------------------------------------
// Cards — remove
// ---------------------------------------------------------------------------

export async function removeCard(cardId: string, userId: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const card = (await db.savedCard.findUnique({
    where: { id: cardId },
    select: { id: true, user_id: true, is_default: true },
  })) as { id: string; user_id: string; is_default: boolean } | null;

  if (!card) throw new AppError(ErrorCode.NOT_FOUND, 'Card not found.');
  if (card.user_id !== userId) throw new AppError(ErrorCode.FORBIDDEN, 'You do not own this card.');

  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  await db.savedCard.delete({ where: { id: cardId } });

  // If removed card was default, promote oldest remaining card to default
  if (card.is_default) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const next = (await db.savedCard.findFirst({
      where: { user_id: userId },
      orderBy: { created_at: 'asc' },
      select: { id: true },
    })) as { id: string } | null;

    if (next) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      await db.savedCard.update({
        where: { id: next.id },
        data: { is_default: true },
      });
    }
  }

  logger.info('Card removed', { card_id: cardId, user_id: userId });
}

// ---------------------------------------------------------------------------
// Card deposit — initiate
// ---------------------------------------------------------------------------

export async function initiateCardDeposit(
  userId: string,
  input: CardDepositInput,
  idempotencyKey: string,
): Promise<DepositRecord> {
  const amountKobo = toKobo(input.amount_kobo);

  // Load card + verify ownership
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const card = (await db.savedCard.findUnique({
    where: { id: input.card_id },
    select: { id: true, user_id: true, authorization_code: true, last4: true },
  })) as { id: string; user_id: string; authorization_code: string; last4: string } | null;

  if (!card) throw new AppError(ErrorCode.NOT_FOUND, 'Card not found.');
  if (card.user_id !== userId) throw new AppError(ErrorCode.FORBIDDEN, 'You do not own this card.');

  // Load user wallet + email
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const user = (await db.user.findUnique({
    where: { id: userId },
    select: {
      email: true,
      account_status: true,
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
  })) as {
    email: string | null;
    account_status: string;
    wallet: { id: string } | null;
    auth: {
      transaction_pin_hash: string | null;
      transaction_pin_failed_attempts: number;
      transaction_pin_locked_until: Date | null;
      transaction_pin_hard_locked: boolean;
      transaction_pin_lockout_count: number;
    } | null;
  } | null;

  if (!user) throw new AppError(ErrorCode.NOT_FOUND, 'User not found.');
  if (!user.wallet) throw new AppError(ErrorCode.NOT_FOUND, 'Wallet not found.');
  if (user.account_status !== 'active')
    throw new AppError(ErrorCode.FORBIDDEN, 'Account is not active.');
  if (!user.auth?.transaction_pin_hash)
    throw new AppError(ErrorCode.CONFLICT, 'Please set a transaction PIN first.');

  const walletId = user.wallet.id;
  const auth = user.auth;

  // PIN verify — deposits require PIN to prevent unauthorised charges on stolen devices
  await assertNotLocked(userId, 'pin', async () => ({
    hard_locked: auth.transaction_pin_hard_locked,
    locked_until: auth.transaction_pin_locked_until,
  }));

  const pinValid = await argon2.verify(auth.transaction_pin_hash as string, input.pin);
  if (!pinValid) {
    const lock = await recordFailedAttempt(
      userId,
      'pin',
      auth.transaction_pin_failed_attempts,
      auth.transaction_pin_lockout_count,
    );
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

  // Create pending deposit record
  const reference = generateDepositReference();
  const fee = BigInt(0); // no deposit fee
  const netAmount = amountKobo - fee;

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const deposit = (await db.deposit.create({
    data: {
      wallet_id: walletId,
      channel: 'card',
      status: 'pending',
      amount: amountKobo,
      fee,
      net_amount: netAmount,
      reference,
      idempotency_key: idempotencyKey,
      card_id: input.card_id,
      narration: `Card deposit ****${card.last4}`,
    },
  })) as DepositRow;

  // Queue async card charge
  await cardDepositQueue.add(
    'charge_card',
    {
      depositId: deposit.id,
      reference,
      walletId,
      amountKobo: amountKobo.toString(),
      authorizationCode: card.authorization_code,
      email: user.email ?? 'noreply@flowkey.app',
    },
    {
      jobId: `card-deposit-${deposit.id}`,
      delay: 1000,
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    },
  );

  logger.info('Card deposit initiated', {
    deposit_id: deposit.id,
    reference,
    wallet_id: walletId,
    amount_kobo: amountKobo.toString(),
  });

  return toDepositRecord(deposit);
}

// ---------------------------------------------------------------------------
// Wallet credit — called by webhooks and workers
// Idempotent by provider_ref + wallet_id
// ---------------------------------------------------------------------------

export async function creditWallet(params: {
  walletId: string;
  amountKobo: bigint;
  channel: DepositChannel;
  reference: string;
  providerRef: string;
  narration: string | null;
  depositId?: string; // links to existing deposit record if card deposit
}): Promise<void> {
  // Idempotency check — prevent double credits
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const existing = (await db.ledgerEntry.findFirst({
    where: {
      wallet_id: params.walletId,
      transaction: { reference: params.reference },
    },
    select: { id: true },
  })) as { id: string } | null;

  if (existing) {
    logger.warn('Duplicate credit attempt blocked', {
      reference: params.reference,
      provider_ref: params.providerRef,
      wallet_id: params.walletId,
    });
    return;
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  await db.$transaction(
    async (tx: typeof db) => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      const txn = await tx.transaction.create({
        data: {
          type: 'funding',
          status: 'completed',
          amount: params.amountKobo,
          fee: BigInt(0),
          net_amount: params.amountKobo,
          narration: params.narration,
          reference: params.reference,
          idempotency_key: crypto.randomUUID(),
          initiator_id: '00000000-0000-0000-0000-000000000000',
          initiator_type: 'system',
          sender_wallet_id: null,
          receiver_wallet_id: params.walletId,
          completed_at: new Date(),
          metadata: {
            channel: params.channel,
            provider_ref: params.providerRef,
            deposit_id: params.depositId ?? null,
          },
        },
      });

      const txnId = (txn as { id: string }).id;

      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      await tx.ledgerEntry.create({
        data: {
          wallet_id: params.walletId,
          transaction_id: txnId,
          type: 'credit',
          amount: params.amountKobo,
        },
      });

      // Update deposit record status if linked
      if (params.depositId) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
        await tx.deposit.update({
          where: { id: params.depositId },
          data: {
            status: 'completed',
            provider_ref: params.providerRef,
            completed_at: new Date(),
          },
        });
      }

      // Audit log
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      await tx.auditLog.create({
        data: {
          actor_id: null,
          actor_type: 'system',
          action: `deposit.${params.channel}.credited`,
          target_type: 'wallet',
          target_id: params.walletId,
          previous_hash: 'CHAINED',
          metadata: {
            amount_kobo: params.amountKobo.toString(),
            reference: params.reference,
            provider_ref: params.providerRef,
            channel: params.channel,
          },
        },
      });
    },
    { isolationLevel: 'Serializable' },
  );

  logger.info('Wallet credited', {
    wallet_id: params.walletId,
    amount_kobo: params.amountKobo.toString(),
    channel: params.channel,
    reference: params.reference,
  });
}

// ---------------------------------------------------------------------------
// Deposit history
// ---------------------------------------------------------------------------

export async function listDeposits(
  userId: string,
  input: ListDepositsInput,
): Promise<{ items: DepositRecord[]; next_cursor: string | null }> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const wallet = (await db.wallet.findUnique({
    where: { user_id: userId },
    select: { id: true },
  })) as { id: string } | null;

  if (!wallet) return { items: [], next_cursor: null };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: Record<string, any> = { wallet_id: wallet.id };
  if (input.channel !== 'all') where['channel'] = input.channel;
  if (input.status) where['status'] = input.status;

  if (input.cursor) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const pivot = (await db.deposit.findUnique({
      where: { id: input.cursor },
      select: { created_at: true },
    })) as { created_at: Date } | null;
    if (pivot) where['created_at'] = { lt: pivot.created_at };
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const rows = (await db.deposit.findMany({
    where,
    orderBy: { created_at: 'desc' },
    take: input.limit + 1,
  })) as DepositRow[];

  const items = rows.slice(0, input.limit).map(toDepositRecord);
  const nextCursor = rows.length > input.limit ? (items[items.length - 1]?.id ?? null) : null;

  return { items, next_cursor: nextCursor };
}

// ---------------------------------------------------------------------------
// Internal types + mappers
// ---------------------------------------------------------------------------

interface VirtualAccountRow {
  id: string;
  wallet_id: string;
  account_number: string;
  account_name: string;
  bank_name: string;
  bank_code: string;
  provider: string;
  is_active: boolean;
  created_at: Date;
}

interface SavedCardRow {
  id: string;
  user_id: string;
  last4: string;
  card_type: string;
  bank: string;
  expiry_month: string;
  expiry_year: string;
  is_default: boolean;
  created_at: Date;
}

interface DepositRow {
  id: string;
  wallet_id: string;
  channel: string;
  status: string;
  amount: bigint;
  fee: bigint;
  net_amount: bigint;
  reference: string;
  provider_ref: string | null;
  narration: string | null;
  card_id: string | null;
  created_at: Date;
  completed_at: Date | null;
}

function toVirtualAccountRecord(r: VirtualAccountRow, walletId: string): VirtualAccount {
  return {
    id: r.id,
    wallet_id: walletId,
    account_number: r.account_number,
    account_name: r.account_name,
    bank_name: r.bank_name,
    bank_code: r.bank_code,
    provider: 'providus',
    is_active: r.is_active,
    created_at: r.created_at,
  };
}

function toSavedCardRecord(r: SavedCardRow): SavedCard {
  return {
    id: r.id,
    user_id: r.user_id,
    last4: r.last4,
    card_type: r.card_type,
    bank: r.bank,
    expiry_month: r.expiry_month,
    expiry_year: r.expiry_year,
    is_default: r.is_default,
    created_at: r.created_at,
  };
}

function toDepositRecord(r: DepositRow): DepositRecord {
  return {
    id: r.id,
    wallet_id: r.wallet_id,
    channel: r.channel as DepositChannel,
    status: r.status as DepositStatus,
    amount_kobo: r.amount.toString(),
    fee_kobo: r.fee.toString(),
    net_amount_kobo: r.net_amount.toString(),
    reference: r.reference,
    provider_ref: r.provider_ref,
    narration: r.narration,
    card_id: r.card_id,
    created_at: r.created_at,
    completed_at: r.completed_at,
  };
}
