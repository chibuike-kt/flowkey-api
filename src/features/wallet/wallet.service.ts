import { AppError, ErrorCode } from '../../common/errors/AppError';
import { prisma } from '../../common/utils/prisma';
import type {
  WalletBalance,
  TransactionListItem,
  TransactionListResult,
  TransactionDetail,
  TransactionLabel,
  CounterpartyDetail,
  BankCounterparty,
} from './wallet.types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function transactionNumber(reference: string): string {
  const parts = reference.split('-');
  return `TXN-${parts[parts.length - 1] ?? reference}`;
}

function labelFor(
  type: string,
  direction: 'credit' | 'debit',
  _metadata: Record<string, unknown> | null,
): TransactionLabel {
  switch (type) {
    case 'funding':
      return 'Deposit — Bank Transfer';
    case 'reversal':
      return 'Reversal';
    case 'transfer_internal':
      return direction === 'credit' ? 'Money Received' : 'Transfer Sent';
    case 'transfer_bank':
      return 'Bank Transfer';
    default:
      return 'Transfer';
  }
}

function paymentMethodFor(type: string, metadata: Record<string, unknown> | null): string {
  const source = metadata?.['source'] as string | undefined;
  const authMethod = metadata?.['auth_method'] as string | undefined;

  if (type === 'funding') {
    const channel = metadata?.['channel'] as string | undefined;
    return channel === 'card' ? 'Deposit — Card' : 'Deposit — Bank Transfer';
  }
  if (type === 'reversal') return 'Reversal';
  if (authMethod === 'upp' || source === 'universal_id') {
    return type === 'transfer_bank'
      ? 'Universal ID — FlowKey to Bank'
      : 'Universal ID — FlowKey to FlowKey';
  }
  if (source === 'qr_code') return 'QR Code';
  if (type === 'transfer_bank') return 'FlowKey to Bank';
  return 'FlowKey to FlowKey';
}

// ---------------------------------------------------------------------------
// GET /wallet/balance
// ---------------------------------------------------------------------------

export async function getWalletBalance(userId: string): Promise<WalletBalance> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const user = (await db.user.findUnique({
    where: { id: userId },
    select: { universal_id: true, kyc_tier: true, wallet: { select: { id: true } } },
  })) as { universal_id: string; kyc_tier: number; wallet: { id: string } | null } | null;

  if (!user?.wallet) throw new AppError(ErrorCode.NOT_FOUND, 'Wallet not found.');

  const walletId = user.wallet.id;

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const [creditAgg, debitAgg, lastEntry] = await db.$transaction([
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
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    db.ledgerEntry.findFirst({
      where: { wallet_id: walletId },
      orderBy: { created_at: 'desc' },
      select: { created_at: true },
    }),
  ]);

  const totalCredit = (creditAgg as { _sum: { amount: bigint | null } })._sum.amount ?? BigInt(0);
  const totalDebit = (debitAgg as { _sum: { amount: bigint | null } })._sum.amount ?? BigInt(0);

  return {
    wallet_id: walletId,
    balance_kobo: (totalCredit - totalDebit).toString(),
    ledger_credit_kobo: totalCredit.toString(),
    ledger_debit_kobo: totalDebit.toString(),
    last_updated_at: (lastEntry as { created_at: Date } | null)?.created_at ?? null,
    universal_id: user.universal_id,
    kyc_tier: user.kyc_tier < 1 ? 1 : user.kyc_tier,
    currency: 'NGN',
  };
}

// ---------------------------------------------------------------------------
// GET /wallet/transactions — full history, all types
// ---------------------------------------------------------------------------

export async function listWalletTransactions(
  userId: string,
  cursor?: string,
  limit = 20,
): Promise<TransactionListResult> {
  const walletId = await resolveWalletId(userId);

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const rows = (await db.transaction.findMany({
    where: {
      OR: [{ sender_wallet_id: walletId }, { receiver_wallet_id: walletId }],
    },
    orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
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
      completed_at: true,
      created_at: true,
      // Load counterparty user via wallet relation
      sender_wallet: {
        select: { user: { select: { username: true, display_name: true } } },
      },
      receiver_wallet: {
        select: { user: { select: { username: true, display_name: true } } },
      },
    },
  })) as TxRow[];

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? (page[page.length - 1]?.id ?? null) : null;

  const transactions: TransactionListItem[] = page.map((tx) => {
    const direction: 'credit' | 'debit' = tx.receiver_wallet_id === walletId ? 'credit' : 'debit';

    const meta = (tx.metadata ?? {}) as Record<string, unknown>;

    // Counterparty display name
    let counterparty: string | null = null;
    if (direction === 'credit' && tx.sender_wallet?.user) {
      counterparty = tx.sender_wallet.user.display_name ?? tx.sender_wallet.user.username;
    } else if (direction === 'debit') {
      if (tx.type === 'transfer_bank') {
        const acctLast4 = meta['account_number_last4'] as string | undefined;
        const bankName = meta['bank_name'] as string | undefined;
        counterparty = acctLast4
          ? `${bankName ?? 'Bank'} ****${acctLast4}`
          : ((meta['account_name'] as string | null) ?? null);
      } else if (tx.receiver_wallet?.user) {
        counterparty = tx.receiver_wallet.user.display_name ?? tx.receiver_wallet.user.username;
      }
    }

    // For funding credits the counterparty is the funding source
    if (tx.type === 'funding') {
      const channel = meta['channel'] as string | undefined;
      counterparty = channel === 'card' ? 'Card Deposit' : 'Bank Transfer';
    }
    if (tx.type === 'reversal') counterparty = 'System';

    return {
      id: tx.id,
      transaction_number: transactionNumber(tx.reference),
      reference: tx.reference,
      type: tx.type,
      label: labelFor(tx.type, direction, meta),
      status: tx.status,
      direction,
      amount_kobo: tx.amount.toString(),
      fee_kobo: tx.fee.toString(),
      net_amount_kobo: tx.net_amount.toString(),
      narration: tx.narration,
      counterparty,
      payment_method: paymentMethodFor(tx.type, meta),
      created_at: tx.created_at,
      completed_at: tx.completed_at,
    };
  });

  return { transactions, next_cursor: nextCursor };
}

// ---------------------------------------------------------------------------
// GET /wallet/transactions/:id — full detail
// ---------------------------------------------------------------------------

export async function getTransactionDetail(
  transactionId: string,
  userId: string,
): Promise<TransactionDetail> {
  const walletId = await resolveWalletId(userId);

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const tx = (await db.transaction.findUnique({
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
      completed_at: true,
      created_at: true,
      sender_wallet: {
        select: { id: true, user: { select: { id: true, username: true, display_name: true } } },
      },
      receiver_wallet: {
        select: { id: true, user: { select: { id: true, username: true, display_name: true } } },
      },
      receipts: { select: { public_token: true }, take: 1 },
    },
  })) as TxDetailRow | null;

  if (!tx) throw new AppError(ErrorCode.NOT_FOUND, 'Transaction not found.');

  // Verify this wallet is party to the transaction
  const isSender = tx.sender_wallet_id === walletId;
  const isReceiver = tx.receiver_wallet_id === walletId;
  if (!isSender && !isReceiver) {
    throw new AppError(ErrorCode.FORBIDDEN, 'You do not have access to this transaction.');
  }

  const direction: 'credit' | 'debit' = isReceiver ? 'credit' : 'debit';
  const meta = (tx.metadata ?? {}) as Record<string, unknown>;

  // Build sender counterparty
  let sender: CounterpartyDetail | null = null;
  if (tx.sender_wallet?.user) {
    sender = {
      display_name: tx.sender_wallet.user.display_name ?? tx.sender_wallet.user.username,
      username: tx.sender_wallet.user.username,
      wallet_id: tx.sender_wallet.id,
    };
  } else if (tx.type === 'funding' || tx.type === 'reversal') {
    sender = { display_name: 'FlowKey System', username: null, wallet_id: '' };
  }

  // Build recipient counterparty
  let recipient: CounterpartyDetail | BankCounterparty | null = null;
  if (tx.type === 'transfer_bank') {
    const acctLast4 = meta['account_number_last4'] as string | undefined;
    recipient = {
      account_number: acctLast4 ? `****${acctLast4}` : '****',
      account_name: ((meta['verified_account_name'] ?? meta['account_name']) as string) ?? '',
      bank_name: (meta['bank_name'] as string) ?? '',
      bank_code: (meta['bank_code'] as string) ?? '',
    };
  } else if (tx.receiver_wallet?.user) {
    recipient = {
      display_name: tx.receiver_wallet.user.display_name ?? tx.receiver_wallet.user.username,
      username: tx.receiver_wallet.user.username,
      wallet_id: tx.receiver_wallet.id,
    };
  }

  const publicToken = (tx.receipts as { public_token: string }[] | undefined)?.[0]?.public_token;

  return {
    id: tx.id,
    transaction_number: transactionNumber(tx.reference),
    reference: tx.reference,
    type: tx.type,
    label: labelFor(tx.type, direction, meta),
    status: tx.status,
    direction,
    payment_method: paymentMethodFor(tx.type, meta),
    amount_kobo: tx.amount.toString(),
    fee_kobo: tx.fee.toString(),
    net_amount_kobo: tx.net_amount.toString(),
    narration: tx.narration,
    created_at: tx.created_at,
    completed_at: tx.completed_at,
    sender,
    recipient,
    receipt_url: publicToken ? `/receipts/${publicToken}` : null,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function resolveWalletId(userId: string): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const wallet = (await db.wallet.findUnique({
    where: { user_id: userId },
    select: { id: true },
  })) as { id: string } | null;
  if (!wallet) throw new AppError(ErrorCode.NOT_FOUND, 'Wallet not found.');
  return wallet.id;
}

interface TxRow {
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
  completed_at: Date | null;
  created_at: Date;
  sender_wallet: { user: { username: string; display_name: string | null } | null } | null;
  receiver_wallet: { user: { username: string; display_name: string | null } | null } | null;
}

interface TxDetailRow extends TxRow {
  sender_wallet: {
    id: string;
    user: { id: string; username: string; display_name: string | null } | null;
  } | null;
  receiver_wallet: {
    id: string;
    user: { id: string; username: string; display_name: string | null } | null;
  } | null;
  receipts: { public_token: string }[];
}
