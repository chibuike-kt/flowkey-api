/**
 * Phase 7 — Wallet tests
 */

import type { WalletBalance, TransactionListItem } from '../../../src/features/wallet/wallet.types';

// ---------------------------------------------------------------------------
// Balance computation — pure logic
// ---------------------------------------------------------------------------

describe('Balance computation', () => {
  function computeBalance(credits: bigint[], debits: bigint[]): bigint {
    const totalCredit = credits.reduce((s, v) => s + v, BigInt(0));
    const totalDebit = debits.reduce((s, v) => s + v, BigInt(0));
    return totalCredit - totalDebit;
  }

  it('returns zero for empty ledger', () => {
    expect(computeBalance([], [])).toBe(BigInt(0));
  });

  it('returns full credit when no debits', () => {
    expect(computeBalance([BigInt(10000), BigInt(5000)], [])).toBe(BigInt(15000));
  });

  it('subtracts debits from credits correctly', () => {
    expect(computeBalance([BigInt(50000)], [BigInt(20000)])).toBe(BigInt(30000));
  });

  it('produces zero balance when credits equal debits', () => {
    expect(computeBalance([BigInt(10000)], [BigInt(10000)])).toBe(BigInt(0));
  });

  it('handles large kobo values (₦5,000,000 = 500,000,000 kobo)', () => {
    expect(computeBalance([BigInt('500000000')], [BigInt('250000000')])).toBe(BigInt('250000000'));
  });

  it('balance = credit total - debit total', () => {
    const credits = [BigInt(100000), BigInt(200000)];
    const debits = [BigInt(50000)];
    const total =
      credits.reduce((s, v) => s + v, BigInt(0)) - debits.reduce((s, v) => s + v, BigInt(0));
    expect(computeBalance(credits, debits)).toBe(total);
  });
});

// ---------------------------------------------------------------------------
// WalletBalance type
// ---------------------------------------------------------------------------

describe('WalletBalance type contract', () => {
  const mock: WalletBalance = {
    wallet_id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
    balance_kobo: '25000000',
    ledger_credit_kobo: '50000000',
    ledger_debit_kobo: '25000000',
    last_updated_at: new Date('2026-05-06T10:00:00Z'),
  };

  it('balance_kobo is a string', () => {
    expect(typeof mock.balance_kobo).toBe('string');
  });

  it('credit and debit fields are strings', () => {
    expect(typeof mock.ledger_credit_kobo).toBe('string');
    expect(typeof mock.ledger_debit_kobo).toBe('string');
  });

  it('balance = credit - debit', () => {
    const balance = BigInt(mock.balance_kobo);
    const credit = BigInt(mock.ledger_credit_kobo);
    const debit = BigInt(mock.ledger_debit_kobo);
    expect(balance).toBe(credit - debit);
  });

  it('wallet_id is a string', () => {
    expect(typeof mock.wallet_id).toBe('string');
  });

  it('last_updated_at is Date or null', () => {
    expect(mock.last_updated_at === null || mock.last_updated_at instanceof Date).toBe(true);
  });

  it('accepts null last_updated_at (fresh wallet)', () => {
    const fresh: WalletBalance = {
      ...mock,
      balance_kobo: '0',
      ledger_credit_kobo: '0',
      ledger_debit_kobo: '0',
      last_updated_at: null,
    };
    expect(fresh.last_updated_at).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Transaction direction derivation
// ---------------------------------------------------------------------------

describe('Transaction direction derivation', () => {
  const MY_WALLET = 'wallet-mine-123';
  const OTHER = 'wallet-other-999';

  function deriveDirection(
    sender: string | null,
    receiver: string | null,
    wallet: string,
  ): 'credit' | 'debit' | null {
    if (receiver === wallet) return 'credit';
    if (sender === wallet) return 'debit';
    return null;
  }

  it('returns credit when wallet is receiver', () => {
    expect(deriveDirection(OTHER, MY_WALLET, MY_WALLET)).toBe('credit');
  });

  it('returns debit when wallet is sender', () => {
    expect(deriveDirection(MY_WALLET, OTHER, MY_WALLET)).toBe('debit');
  });

  it('returns null when wallet is neither sender nor receiver', () => {
    expect(deriveDirection(OTHER, OTHER, MY_WALLET)).toBeNull();
  });

  it('returns null when both sides are null', () => {
    expect(deriveDirection(null, null, MY_WALLET)).toBeNull();
  });

  it('returns debit when sender matches and receiver is null (bill payment)', () => {
    expect(deriveDirection(MY_WALLET, null, MY_WALLET)).toBe('debit');
  });

  it('returns credit when receiver matches and sender is null (funding)', () => {
    expect(deriveDirection(null, MY_WALLET, MY_WALLET)).toBe('credit');
  });
});

// ---------------------------------------------------------------------------
// TransactionListItem type
// ---------------------------------------------------------------------------

describe('TransactionListItem type contract', () => {
  const mock: TransactionListItem = {
    id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
    type: 'transfer_internal',
    status: 'completed',
    amount_kobo: '500000',
    fee_kobo: '5000',
    net_amount_kobo: '495000',
    narration: 'Lunch money',
    reference: 'FLK-20260506-001',
    direction: 'debit',
    counterparty_wallet_id: 'wallet-other-999',
    completed_at: new Date('2026-05-06T10:01:00Z'),
    created_at: new Date('2026-05-06T10:00:00Z'),
  };

  it('all kobo fields are strings', () => {
    expect(typeof mock.amount_kobo).toBe('string');
    expect(typeof mock.fee_kobo).toBe('string');
    expect(typeof mock.net_amount_kobo).toBe('string');
  });

  it('net_amount = amount - fee', () => {
    expect(BigInt(mock.net_amount_kobo)).toBe(BigInt(mock.amount_kobo) - BigInt(mock.fee_kobo));
  });

  it('direction is credit, debit, or null', () => {
    expect(['credit', 'debit', null]).toContain(mock.direction);
  });

  it('created_at is a Date', () => {
    expect(mock.created_at).toBeInstanceOf(Date);
  });

  it('completed_at is Date or null', () => {
    expect(mock.completed_at === null || mock.completed_at instanceof Date).toBe(true);
  });

  it('accepts null direction (bill payment with no counterparty)', () => {
    const bill: TransactionListItem = { ...mock, direction: null, counterparty_wallet_id: null };
    expect(bill.direction).toBeNull();
    expect(bill.counterparty_wallet_id).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Cursor pagination — slice logic
// ---------------------------------------------------------------------------

describe('Cursor pagination — slice logic', () => {
  function paginate<T extends { id: string }>(items: T[], limit: number) {
    const hasMore = items.length > limit;
    const page = hasMore ? items.slice(0, limit) : items;
    const next_cursor = hasMore ? (page[page.length - 1]?.id ?? null) : null;
    return { page, next_cursor };
  }

  const items = Array.from({ length: 25 }, (_, i) => ({ id: `id-${String(i).padStart(3, '0')}` }));

  it('returns exactly limit items when more exist', () => {
    expect(paginate(items, 20).page).toHaveLength(20);
  });

  it('next_cursor is the last item id of the current page', () => {
    const { page, next_cursor } = paginate(items, 20);
    expect(next_cursor).toBe(page[page.length - 1]?.id);
  });

  it('returns null next_cursor on final page', () => {
    expect(paginate(items.slice(0, 10), 20).next_cursor).toBeNull();
  });

  it('returns all items when count is less than limit', () => {
    expect(paginate(items.slice(0, 5), 20).page).toHaveLength(5);
  });

  it('returns empty array and null cursor for empty result', () => {
    const { page, next_cursor } = paginate([], 20);
    expect(page).toHaveLength(0);
    expect(next_cursor).toBeNull();
  });

  it('limit of 1 returns single item', () => {
    const { page, next_cursor } = paginate(items, 1);
    expect(page).toHaveLength(1);
    expect(next_cursor).toBe('id-000');
  });
});
