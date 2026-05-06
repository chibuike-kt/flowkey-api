import { AppError, ErrorCode } from '../../common/errors/AppError';
import { prisma } from '../../common/utils/prisma';
import type { WalletBalance, TransactionListItem, TransactionListResult } from './wallet.types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

// ---------------------------------------------------------------------------
// GET /wallet/balance
// ---------------------------------------------------------------------------

export async function getWalletBalance(userId: string): Promise<WalletBalance> {
  // 1. Resolve wallet for this user
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const wallet = await db.wallet.findUnique({
    where: { user_id: userId },
    select: { id: true },
  });

  if (!wallet) {
    throw new AppError(ErrorCode.NOT_FOUND, 'Wallet not found.');
  }
  const walletId = (wallet as { id: string }).id;

  // 2. Aggregate ledger entries — sum credits and debits separately
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
  const balance = totalCredit - totalDebit;
  const lastUpdatedAt = (lastEntry as { created_at: Date } | null)?.created_at ?? null;

  return {
    wallet_id: walletId,
    balance_kobo: balance.toString(),
    ledger_credit_kobo: totalCredit.toString(),
    ledger_debit_kobo: totalDebit.toString(),
    last_updated_at: lastUpdatedAt,
  };
}

// ---------------------------------------------------------------------------
// GET /wallet/transactions
// ---------------------------------------------------------------------------

export async function listWalletTransactions(
  userId: string,
  cursor?: string,
  limit = 20,
): Promise<TransactionListResult> {
  // 1. Resolve wallet
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const wallet = await db.wallet.findUnique({
    where: { user_id: userId },
    select: { id: true },
  });

  if (!wallet) {
    throw new AppError(ErrorCode.NOT_FOUND, 'Wallet not found.');
  }
  const walletId = (wallet as { id: string }).id;

  // 2. Fetch transactions where this wallet is sender or receiver
  //    Cursor-based pagination on created_at DESC, then id DESC for stability
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const rows = await db.transaction.findMany({
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
      sender_wallet_id: true,
      receiver_wallet_id: true,
      completed_at: true,
      created_at: true,
    },
  });

  type TxRow = {
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
    completed_at: Date | null;
    created_at: Date;
  };

  const items = rows as TxRow[];
  const hasMore = items.length > limit;
  const page = hasMore ? items.slice(0, limit) : items;
  const nextCursor = hasMore ? (page[page.length - 1]?.id ?? null) : null;

  const transactions: TransactionListItem[] = page.map((tx) => {
    // Direction is relative to this wallet
    let direction: 'credit' | 'debit' | null = null;
    if (tx.receiver_wallet_id === walletId) direction = 'credit';
    else if (tx.sender_wallet_id === walletId) direction = 'debit';

    // Counterparty is the other side of the transfer
    const counterparty = direction === 'credit' ? tx.sender_wallet_id : tx.receiver_wallet_id;

    return {
      id: tx.id,
      type: tx.type,
      status: tx.status,
      amount_kobo: tx.amount.toString(),
      fee_kobo: tx.fee.toString(),
      net_amount_kobo: tx.net_amount.toString(),
      narration: tx.narration,
      reference: tx.reference,
      direction,
      counterparty_wallet_id: counterparty,
      completed_at: tx.completed_at,
      created_at: tx.created_at,
    };
  });

  return { transactions, next_cursor: nextCursor };
}
