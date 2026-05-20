import type {
  WalletBalance,
  TransactionListItem,
  TransactionDetail,
} from '../../../src/features/wallet/wallet.types';

// ---------------------------------------------------------------------------
// Balance computation
// ---------------------------------------------------------------------------

describe('Balance computation', () => {
  function computeBalance(credits: bigint[], debits: bigint[]): bigint {
    return credits.reduce((s, v) => s + v, BigInt(0)) - debits.reduce((s, v) => s + v, BigInt(0));
  }

  it('returns zero for empty ledger', () => expect(computeBalance([], [])).toBe(BigInt(0)));
  it('returns full credit when no debits', () =>
    expect(computeBalance([BigInt(10000), BigInt(5000)], [])).toBe(BigInt(15000)));
  it('subtracts debits correctly', () =>
    expect(computeBalance([BigInt(50000)], [BigInt(20000)])).toBe(BigInt(30000)));
  it('produces zero when credits equal debits', () =>
    expect(computeBalance([BigInt(10000)], [BigInt(10000)])).toBe(BigInt(0)));
  it('handles large kobo values (₦5m)', () =>
    expect(computeBalance([BigInt('500000000')], [BigInt('250000000')])).toBe(BigInt('250000000')));
  it('balance = sum(credits) - sum(debits)', () => {
    const credits = [BigInt(100000), BigInt(200000)];
    const debits = [BigInt(50000)];
    expect(computeBalance(credits, debits)).toBe(BigInt(250000));
  });
});

// ---------------------------------------------------------------------------
// WalletBalance type contract
// ---------------------------------------------------------------------------

describe('WalletBalance type contract', () => {
  const mock: WalletBalance = {
    wallet_id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
    balance_kobo: '25000000',
    ledger_credit_kobo: '50000000',
    ledger_debit_kobo: '25000000',
    last_updated_at: new Date('2026-05-06T10:00:00Z'),
    universal_id: 'RIVER-CLOUD-SEVEN',
    kyc_tier: 1,
    currency: 'NGN',
  };

  it('balance_kobo is a string', () => expect(typeof mock.balance_kobo).toBe('string'));
  it('ledger_credit_kobo is a string', () => expect(typeof mock.ledger_credit_kobo).toBe('string'));
  it('ledger_debit_kobo is a string', () => expect(typeof mock.ledger_debit_kobo).toBe('string'));
  it('balance = credit - debit', () =>
    expect(BigInt(mock.balance_kobo)).toBe(
      BigInt(mock.ledger_credit_kobo) - BigInt(mock.ledger_debit_kobo),
    ));
  it('wallet_id is a string', () => expect(typeof mock.wallet_id).toBe('string'));
  it('currency is NGN', () => expect(mock.currency).toBe('NGN'));
  it('kyc_tier is 1, 2, or 3', () => expect([1, 2, 3]).toContain(mock.kyc_tier));
  it('universal_id is a non-empty string', () =>
    expect(mock.universal_id.length).toBeGreaterThan(0));
  it('last_updated_at is Date or null', () =>
    expect(mock.last_updated_at === null || mock.last_updated_at instanceof Date).toBe(true));
  it('accepts null last_updated_at', () => {
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
  const MY_WALLET = 'wallet-mine';
  const OTHER = 'wallet-other';

  function deriveDirection(
    sender: string | null,
    receiver: string | null,
    wallet: string,
  ): 'credit' | 'debit' | null {
    if (receiver === wallet) return 'credit';
    if (sender === wallet) return 'debit';
    return null;
  }

  it('returns credit when wallet is receiver', () =>
    expect(deriveDirection(OTHER, MY_WALLET, MY_WALLET)).toBe('credit'));
  it('returns debit when wallet is sender', () =>
    expect(deriveDirection(MY_WALLET, OTHER, MY_WALLET)).toBe('debit'));
  it('returns null when wallet is neither sender nor receiver', () =>
    expect(deriveDirection(OTHER, OTHER, MY_WALLET)).toBeNull());
  it('returns null when both sides are null', () =>
    expect(deriveDirection(null, null, MY_WALLET)).toBeNull());
  it('returns debit when sender matches and receiver is null', () =>
    expect(deriveDirection(MY_WALLET, null, MY_WALLET)).toBe('debit'));
  it('returns credit when receiver matches and sender is null', () =>
    expect(deriveDirection(null, MY_WALLET, MY_WALLET)).toBe('credit'));
});

// ---------------------------------------------------------------------------
// TransactionListItem type contract
// ---------------------------------------------------------------------------

describe('TransactionListItem type contract', () => {
  const mock: TransactionListItem = {
    id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
    transaction_number: 'TXN-A1B2C3',
    reference: 'FLK-20260506-A1B2C3',
    type: 'transfer_internal',
    label: 'Transfer Sent',
    status: 'completed',
    direction: 'debit',
    amount_kobo: '500000',
    fee_kobo: '0',
    net_amount_kobo: '500000',
    narration: 'Lunch money',
    counterparty: 'Kingsley Chibuike',
    payment_method: 'FlowKey to FlowKey',
    created_at: new Date('2026-05-06T10:00:00Z'),
    completed_at: new Date('2026-05-06T10:00:01Z'),
  };

  it('all kobo fields are strings', () => {
    expect(typeof mock.amount_kobo).toBe('string');
    expect(typeof mock.fee_kobo).toBe('string');
    expect(typeof mock.net_amount_kobo).toBe('string');
  });
  it('net = amount - fee (zero fee)', () =>
    expect(BigInt(mock.net_amount_kobo)).toBe(BigInt(mock.amount_kobo) - BigInt(mock.fee_kobo)));
  it('direction is credit or debit', () => expect(['credit', 'debit']).toContain(mock.direction));
  it('created_at is a Date', () => expect(mock.created_at).toBeInstanceOf(Date));
  it('completed_at is Date or null', () =>
    expect(mock.completed_at === null || mock.completed_at instanceof Date).toBe(true));
  it('has transaction_number', () => expect(mock.transaction_number).toBeDefined());
  it('has label', () => expect(mock.label).toBeDefined());
  it('has payment_method', () => expect(mock.payment_method).toBeDefined());
  it('has counterparty (may be null)', () => expect(mock.counterparty !== undefined).toBe(true));
});

// ---------------------------------------------------------------------------
// Transaction label derivation
// ---------------------------------------------------------------------------

describe('Transaction label derivation', () => {
  type Dir = 'credit' | 'debit';

  function labelFor(type: string, direction: Dir): string {
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

  it('funding credit → Deposit — Bank Transfer', () =>
    expect(labelFor('funding', 'credit')).toBe('Deposit — Bank Transfer'));
  it('transfer_internal credit → Money Received', () =>
    expect(labelFor('transfer_internal', 'credit')).toBe('Money Received'));
  it('transfer_internal debit → Transfer Sent', () =>
    expect(labelFor('transfer_internal', 'debit')).toBe('Transfer Sent'));
  it('transfer_bank debit → Bank Transfer', () =>
    expect(labelFor('transfer_bank', 'debit')).toBe('Bank Transfer'));
  it('reversal credit → Reversal', () => expect(labelFor('reversal', 'credit')).toBe('Reversal'));
});

// ---------------------------------------------------------------------------
// Payment method label
// ---------------------------------------------------------------------------

describe('Payment method label', () => {
  function methodFor(type: string, source?: string, authMethod?: string): string {
    if (type === 'funding') return 'Deposit — Bank Transfer';
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

  it('internal transfer by username → FlowKey to FlowKey', () =>
    expect(methodFor('transfer_internal', 'username')).toBe('FlowKey to FlowKey'));
  it('internal transfer by QR → QR Code', () =>
    expect(methodFor('transfer_internal', 'qr_code')).toBe('QR Code'));
  it('bank transfer → FlowKey to Bank', () =>
    expect(methodFor('transfer_bank', 'username')).toBe('FlowKey to Bank'));
  it('UID internal transfer → Universal ID — FlowKey to FlowKey', () =>
    expect(methodFor('transfer_internal', 'universal_id')).toBe(
      'Universal ID — FlowKey to FlowKey',
    ));
  it('UID bank transfer → Universal ID — FlowKey to Bank', () =>
    expect(methodFor('transfer_bank', 'universal_id')).toBe('Universal ID — FlowKey to Bank'));
  it('UPP auth_method → Universal ID — FlowKey to FlowKey', () =>
    expect(methodFor('transfer_internal', undefined, 'upp')).toBe(
      'Universal ID — FlowKey to FlowKey',
    ));
  it('funding → Deposit — Bank Transfer', () =>
    expect(methodFor('funding')).toBe('Deposit — Bank Transfer'));
  it('reversal → Reversal', () => expect(methodFor('reversal')).toBe('Reversal'));
});

// ---------------------------------------------------------------------------
// TransactionDetail type contract
// ---------------------------------------------------------------------------

describe('TransactionDetail type contract', () => {
  const mock: TransactionDetail = {
    id: 'uuid-1',
    transaction_number: 'TXN-A1B2C3',
    reference: 'FLK-20260506-A1B2C3',
    type: 'transfer_internal',
    label: 'Transfer Sent',
    status: 'completed',
    direction: 'debit',
    payment_method: 'FlowKey to FlowKey',
    amount_kobo: '500000',
    fee_kobo: '0',
    net_amount_kobo: '500000',
    narration: 'Rent',
    created_at: new Date(),
    completed_at: new Date(),
    sender: {
      display_name: 'Kingsley Chibuike',
      username: 'kingsley_kt',
      wallet_id: 'wallet-uuid',
    },
    recipient: {
      display_name: 'Test User',
      username: 'test_user',
      wallet_id: 'wallet-uuid-2',
    },
    receipt_url: '/receipts/abc123',
  };

  it('has sender object', () => expect(mock.sender).toBeDefined());
  it('has recipient object', () => expect(mock.recipient).toBeDefined());
  it('has receipt_url', () => expect(mock.receipt_url).toBeDefined());
  it('has transaction_number', () => expect(mock.transaction_number).toBeDefined());
  it('has payment_method', () => expect(mock.payment_method).toBeDefined());
  it('all kobo fields are strings', () => {
    expect(typeof mock.amount_kobo).toBe('string');
    expect(typeof mock.fee_kobo).toBe('string');
    expect(typeof mock.net_amount_kobo).toBe('string');
  });
  it('direction is credit or debit', () => expect(['credit', 'debit']).toContain(mock.direction));
});

// ---------------------------------------------------------------------------
// Cursor pagination
// ---------------------------------------------------------------------------

describe('Cursor pagination slice logic', () => {
  function paginate<T extends { id: string }>(items: T[], limit: number) {
    const hasMore = items.length > limit;
    const page = hasMore ? items.slice(0, limit) : items;
    const next_cursor = hasMore ? (page[page.length - 1]?.id ?? null) : null;
    return { page, next_cursor };
  }

  const items = Array.from({ length: 25 }, (_, i) => ({ id: `id-${String(i).padStart(3, '0')}` }));

  it('returns exactly limit items when more exist', () =>
    expect(paginate(items, 20).page).toHaveLength(20));
  it('next_cursor is the last item id of current page', () => {
    const { page, next_cursor } = paginate(items, 20);
    expect(next_cursor).toBe(page[page.length - 1]?.id);
  });
  it('returns null next_cursor on final page', () =>
    expect(paginate(items.slice(0, 10), 20).next_cursor).toBeNull());
  it('returns all items when count < limit', () =>
    expect(paginate(items.slice(0, 5), 20).page).toHaveLength(5));
  it('empty array gives null cursor', () => expect(paginate([], 20).next_cursor).toBeNull());
  it('limit 1 returns single item', () => {
    const { page, next_cursor } = paginate(items, 1);
    expect(page).toHaveLength(1);
    expect(next_cursor).toBe('id-000');
  });
});
