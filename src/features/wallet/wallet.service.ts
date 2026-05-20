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
    // Bill categories
    case 'airtime':
      return 'Airtime Purchase';
    case 'data':
      return 'Data Purchase';
    case 'tv':
      return 'TV Subscription';
    case 'electricity':
      return 'Electricity Payment';
    case 'education':
      return 'Education Payment';
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
  if (['airtime', 'data', 'tv', 'electricity', 'education'].includes(type)) return 'Bill Payment';
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
    select: {
      universal_id: true,
      kyc_tier: true,
      wallet: {
        select: {
          id: true,
          available_balance: true,
          updated_at: true,
        },
      },
    },
  })) as {
    universal_id: string;
    kyc_tier: number;
    wallet: { id: string; available_balance: bigint; updated_at: Date } | null;
  } | null;

  if (!user?.wallet) throw new AppError(ErrorCode.NOT_FOUND, 'Wallet not found.');

  const walletId = user.wallet.id;
  const balance = user.wallet.available_balance;

  // Ledger aggregates for display (credit/debit totals) — not used for authorization
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const [creditAgg, debitAgg] = await db.$transaction([
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

  const totalCredit = (creditAgg as { _sum: { amount: bigint | null } })._sum.amount ?? BigInt(0);
  const totalDebit = (debitAgg as { _sum: { amount: bigint | null } })._sum.amount ?? BigInt(0);

  return {
    wallet_id: walletId,
    balance_kobo: balance.toString(),
    ledger_credit_kobo: totalCredit.toString(),
    ledger_debit_kobo: totalDebit.toString(),
    last_updated_at: user.wallet.updated_at,
    universal_id: user.universal_id,
    kyc_tier: user.kyc_tier < 1 ? 1 : user.kyc_tier,
    currency: 'NGN',
  };
}

// ---------------------------------------------------------------------------
// GET /wallet/transactions — unified history (transfers + bills)
// ---------------------------------------------------------------------------

export async function listWalletTransactions(
  userId: string,
  cursor?: string,
  limit = 20,
): Promise<TransactionListResult> {
  const walletId = await resolveWalletId(userId);

  // Decode cursor — format: "TYPE:ISO_DATE:ID"
  // TYPE is 'tx' or 'bill', used to know which table the cursor came from
  let txCursorDate: Date | undefined;
  let billCursorDate: Date | undefined;

  if (cursor) {
    try {
      const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
      const [, isoDate] = decoded.split(':') as [string, string, string];
      const d = new Date(isoDate);
      txCursorDate = d;
      billCursorDate = d;
    } catch {
      // Invalid cursor — ignore, start from beginning
    }
  }

  // Fetch limit+1 from both tables in parallel
  const fetchLimit = limit + 1;

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const [txRows, billRows] = await Promise.all([
    // ── Transfers + deposits ────────────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    db.transaction.findMany({
      where: {
        OR: [{ sender_wallet_id: walletId }, { receiver_wallet_id: walletId }],
        ...(txCursorDate ? { created_at: { lt: txCursorDate } } : {}),
      },
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      take: fetchLimit,
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
          select: { user: { select: { username: true, display_name: true } } },
        },
        receiver_wallet: {
          select: { user: { select: { username: true, display_name: true } } },
        },
      },
    }) as TxRow[],

    // ── Bill payments ────────────────────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    db.billTransaction.findMany({
      where: {
        wallet_id: walletId,
        status: {
          in: [
            'delivered',
            'pending',
            'processing',
            'failed',
            'refunded',
            'provider_uncertain',
            'reconciliation_required',
          ],
        },
        ...(billCursorDate ? { created_at: { lt: billCursorDate } } : {}),
      },
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      take: fetchLimit,
      select: {
        id: true,
        category: true,
        status: true,
        amount: true,
        fee: true,
        narration: true,
        reference: true,
        recipient: true,
        purchased_code: true,
        units: true,
        completed_at: true,
        created_at: true,
      },
    }) as BillRow[],
  ]);

  // Normalize both into a common unified shape
  const txItems: UnifiedItem[] = txRows.map((tx) => normalizeTx(tx, walletId));
  const billItems: UnifiedItem[] = billRows.map((bill) => normalizeBill(bill));

  // Merge and sort by created_at desc
  const merged = [...txItems, ...billItems].sort((a, b) => {
    const diff = b.created_at.getTime() - a.created_at.getTime();
    if (diff !== 0) return diff;
    return b.id.localeCompare(a.id);
  });

  // Take exactly limit items
  const hasMore = merged.length > limit;
  const page = merged.slice(0, limit);
  const last = page[page.length - 1];

  // Encode cursor as base64url: "SOURCE:ISO_DATE:ID"
  const nextCursor =
    hasMore && last
      ? Buffer.from(`${last.source}:${last.created_at.toISOString()}:${last.id}`).toString(
          'base64url',
        )
      : null;

  return {
    transactions: page.map((item) => item.listItem),
    next_cursor: nextCursor,
  };
}

// ---------------------------------------------------------------------------
// GET /wallet/transactions/:id — full detail
// ---------------------------------------------------------------------------

export async function getTransactionDetail(
  transactionId: string,
  userId: string,
): Promise<TransactionDetail> {
  const walletId = await resolveWalletId(userId);

  // Try transactions table first
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

  if (tx) {
    const isSender = tx.sender_wallet_id === walletId;
    const isReceiver = tx.receiver_wallet_id === walletId;
    if (!isSender && !isReceiver) {
      throw new AppError(ErrorCode.FORBIDDEN, 'You do not have access to this transaction.');
    }

    const direction: 'credit' | 'debit' = isReceiver ? 'credit' : 'debit';
    const meta = (tx.metadata ?? {}) as Record<string, unknown>;

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

  // Try bill_transactions table
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const bill = (await db.billTransaction.findFirst({
    where: { id: transactionId, wallet_id: walletId },
  })) as (BillRow & { purchased_code: string | null; units: string | null }) | null;

  if (bill) {
    const direction: 'credit' | 'debit' = 'debit';

    return {
      id: bill.id,
      transaction_number: transactionNumber(bill.reference),
      reference: bill.reference,
      type: bill.category,
      label: labelFor(bill.category, direction, null),
      status: bill.status,
      direction,
      payment_method: 'Bill Payment',
      amount_kobo: bill.amount.toString(),
      fee_kobo: bill.fee.toString(),
      net_amount_kobo: bill.amount.toString(),
      narration: bill.narration,
      created_at: bill.created_at,
      completed_at: bill.completed_at,
      sender: null,
      recipient: buildBillRecipient(bill),
      receipt_url: null,
    };
  }

  throw new AppError(ErrorCode.NOT_FOUND, 'Transaction not found.');
}

// ---------------------------------------------------------------------------
// Normalizers
// ---------------------------------------------------------------------------

interface UnifiedItem {
  id: string;
  source: 'tx' | 'bill';
  created_at: Date;
  listItem: TransactionListItem;
}

function normalizeTx(tx: TxRow, walletId: string): UnifiedItem {
  const direction: 'credit' | 'debit' = tx.receiver_wallet_id === walletId ? 'credit' : 'debit';
  const meta = (tx.metadata ?? {}) as Record<string, unknown>;

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
  if (tx.type === 'funding')
    counterparty = (meta['channel'] as string) === 'card' ? 'Card Deposit' : 'Bank Transfer';
  if (tx.type === 'reversal') counterparty = 'System';

  return {
    id: tx.id,
    source: 'tx',
    created_at: tx.created_at,
    listItem: {
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
    },
  };
}

function normalizeBill(bill: BillRow): UnifiedItem {
  const recipientLabel = billRecipientLabel(bill);

  return {
    id: bill.id,
    source: 'bill',
    created_at: bill.created_at,
    listItem: {
      id: bill.id,
      transaction_number: transactionNumber(bill.reference),
      reference: bill.reference,
      type: bill.category,
      label: labelFor(bill.category, 'debit', null),
      status: bill.status,
      direction: 'debit',
      amount_kobo: bill.amount.toString(),
      fee_kobo: bill.fee.toString(),
      net_amount_kobo: bill.amount.toString(),
      narration: bill.narration,
      counterparty: recipientLabel,
      payment_method: 'Bill Payment',
      created_at: bill.created_at,
      completed_at: bill.completed_at,
    },
  };
}

function billRecipientLabel(bill: BillRow): string {
  const r = bill.recipient as Record<string, unknown>;
  switch (bill.category) {
    case 'airtime':
    case 'data':
      return (r['phone'] as string | undefined) ?? bill.category.toUpperCase();
    case 'tv':
      return (r['smartcard'] as string | undefined) ?? 'TV Subscription';
    case 'electricity':
      return `Meter ${String(r['meter_number'] ?? '')
        .slice(-4)
        .padStart(4, '*')}`;
    case 'education':
      return (r['exam_type'] as string | undefined)?.toUpperCase() ?? 'Education';
    default:
      return bill.category.toUpperCase();
  }
}

function buildBillRecipient(bill: BillRow): CounterpartyDetail {
  const label = billRecipientLabel(bill);
  return { display_name: label, username: null, wallet_id: null };
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

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

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

interface BillRow {
  id: string;
  category: string;
  status: string;
  amount: bigint;
  fee: bigint;
  narration: string;
  reference: string;
  recipient: unknown;
  purchased_code?: string | null;
  units?: string | null;
  completed_at: Date | null;
  created_at: Date;
}
