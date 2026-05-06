/**
 * Phase 7 — Wallet unit tests
 *
 * Covers:
 *  - WalletBalance type structure
 *  - Balance computation logic (pure)
 *  - Transaction direction derivation
 *  - Pagination cursor logic
 */

import type { WalletBalance, TransactionListItem } from '../../../src/features/wallet/wallet.types';

// ---------------------------------------------------------------------------
// Balance computation — pure logic tests (no DB required)
// ---------------------------------------------------------------------------

describe('Balance computation', () => {
  function computeBalance(credits: bigint[], debits: bigint[]): bigint {
    const totalCredit = credits.reduce((sum, v) => sum + v, BigInt(0));
    const totalDebit = debits.reduce((sum, v) => sum + v, BigInt(0));
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

  it('can produce zero balance when credits equal debits', () => {
    expect(computeBalance([BigInt(10000)], [BigInt(10000)])).toBe(BigInt(0));
  });

  it('handles large kobo values without overflow', () => {
    // ₦5,000,000 = 500,000,000 kobo — well within BigInt range
    const credits = [BigInt('500000000')];
    const debits = [BigInt('250000000')];
    expect(computeBalance(credits, debits)).toBe(BigInt('250000000'));
  });

  it('balance components sum correctly to overall balance', () => {
    const credits = [BigInt(100000), BigInt(200000)];
    const debits = [BigInt(50000)];
    const balance = computeBalance(credits, debits);
    const totalCredit = credits.reduce((s, v) => s + v, BigInt(0));
    const totalDebit = debits.reduce((s, v) => s + v, BigInt(0));
    expect(balance).toBe(totalCredit - totalDebit);
  });
});

// ---------------------------------------------------------------------------
// WalletBalance type — string encoding
// ---------------------------------------------------------------------------

describe('WalletBalance type contract', () => {
  const mockBalance: WalletBalance = {
    wallet_id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
    balance_kobo: '25000000',
    ledger_credit_kobo: '50000000',
    ledger_debit_kobo: '25000000',
    last_updated_at: new Date('2026-05-06T10:00:00Z'),
  };

  it('balance_kobo is a string', () => {
    expect(typeof mockBalance.balance_kobo).toBe('string');
  });

  it('ledger_credit_kobo and ledger_debit_kobo are strings', () => {
    expect(typeof mockBalance.ledger_credit_kobo).toBe('string');
    expect(typeof mockBalance.ledger_debit_kobo).toBe('string');
  });

  it('balance equals credit minus debit', () => {
    const balance = BigInt(mockBalance.balance_kobo);
    const credit = BigInt(mockBalance.ledger_credit_kobo);
    const debit = BigInt(mockBalance.ledger_debit_kobo);
    expect(balance).toBe(credit - debit);
  });

  it('wallet_id is a string', () => {
    expect(typeof mockBalance.wallet_id).toBe('string');
  });

  it('last_updated_at is a Date or null', () => {
    expect(
      mockBalance.last_updated_at === null || mockBalance.last_updated_at instanceof Date,
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Transaction direction — relative to wallet
// ---------------------------------------------------------------------------

describe('Transaction direction derivation', () => {
  const WALLET_ID = 'wallet-abc-123';
  const OTHER_ID = 'wallet-xyz-999';

  function deriveDirection(
    senderWalletId: string | null,
    receiverWalletId: string | null,
    walletId: string,
  ): 'credit' | 'debit' | null {
    if (receiverWalletId === walletId) return 'credit';
    if (senderWalletId === walletId) return 'debit';
    return null;
  }

  it('returns credit when wallet is receiver', () => {
    expect(deriveDirection(OTHER_ID, WALLET_ID, WALLET_ID)).toBe('credit');
  });

  it('returns debit when wallet is sender', () => {
    expect(deriveDirection(WALLET_ID, OTHER_ID, WALLET_ID)).toBe('debit');
  });

  it('returns null when wallet is neither sender nor receiver', () => {
    expect(deriveDirection(OTHER_ID, OTHER_ID, WALLET_ID)).toBeNull();
  });

  it('returns null when both are null (e.g. bill payment with no receiver)', () => {
    expect(deriveDirection(null, null, WALLET_ID)).toBeNull();
  });

  it('returns debit when sender matches and receiver is null', () => {
    expect(deriveDirection(WALLET_ID, null, WALLET_ID)).toBe('debit');
  });

  it('returns credit when receiver matches and sender is null (funding)', () => {
    expect(deriveDirection(null, WALLET_ID, WALLET_ID)).toBe('credit');
  });
});

// ---------------------------------------------------------------------------
// TransactionListItem type contract
// ---------------------------------------------------------------------------

describe('TransactionListItem type contract', () => {
  const mockTx: TransactionListItem = {
    id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
    type: 'transfer_internal',
    status: 'completed',
    amount_kobo: '500000',
    fee_kobo: '5000',
    net_amount_kobo: '495000',
    narration: 'Lunch money',
    reference: 'FLK-20260506-001',
    direction: 'debit',
    counterparty_wallet_id: 'wallet-xyz-999',
    completed_at: new Date('2026-05-06T10:01:00Z'),
    created_at: new Date('2026-05-06T10:00:00Z'),
  };

  it('all kobo fields are strings', () => {
    expect(typeof mockTx.amount_kobo).toBe('string');
    expect(typeof mockTx.fee_kobo).toBe('string');
    expect(typeof mockTx.net_amount_kobo).toBe('string');
  });

  it('net_amount equals amount minus fee', () => {
    const net = BigInt(mockTx.net_amount_kobo);
    const amt = BigInt(mockTx.amount_kobo);
    const fee = BigInt(mockTx.fee_kobo);
    expect(net).toBe(amt - fee);
  });

  it('direction is credit, debit, or null', () => {
    expect(['credit', 'debit', null]).toContain(mockTx.direction);
  });

  it('created_at is a Date', () => {
    expect(mockTx.created_at).toBeInstanceOf(Date);
  });

  it('completed_at is Date or null', () => {
    expect(mockTx.completed_at === null || mockTx.completed_at instanceof Date).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Pagination cursor logic
// ---------------------------------------------------------------------------

describe('Cursor pagination — slice logic', () => {
  function paginate<T extends { id: string }>(
    items: T[],
    limit: number,
  ): {
    page: T[];
    next_cursor: string | null;
  } {
    const hasMore = items.length > limit;
    const page = hasMore ? items.slice(0, limit) : items;
    const next_cursor = hasMore ? (page[page.length - 1]?.id ?? null) : null;
    return { page, next_cursor };
  }

  const items = Array.from({ length: 25 }, (_, i) => ({ id: `id-${String(i).padStart(3, '0')}` }));

  it('returns limit items when more exist', () => {
    const { page } = paginate(items, 20);
    expect(page).toHaveLength(20);
  });

  it('returns next_cursor pointing to last item of current page', () => {
    const { page, next_cursor } = paginate(items, 20);
    expect(next_cursor).toBe(page[page.length - 1]?.id);
  });

  it('returns null next_cursor on last page', () => {
    const { next_cursor } = paginate(items.slice(0, 10), 20);
    expect(next_cursor).toBeNull();
  });

  it('returns all items when count is less than limit', () => {
    const { page } = paginate(items.slice(0, 5), 20);
    expect(page).toHaveLength(5);
  });

  it('returns empty array and null cursor for empty result', () => {
    const { page, next_cursor } = paginate([], 20);
    expect(page).toHaveLength(0);
    expect(next_cursor).toBeNull();
  });
});
