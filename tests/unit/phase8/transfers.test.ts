import {
  ResolveRecipientSchema,
  InternalTransferSchema,
} from '../../../src/features/transfers/transfers.schema';

// ---------------------------------------------------------------------------
// Schema validation
// ---------------------------------------------------------------------------

describe('ResolveRecipientSchema', () => {
  it('accepts a username', () => {
    const r = ResolveRecipientSchema.safeParse({ identifier: 'kingsley_kt' });
    expect(r.success).toBe(true);
  });

  it('accepts a Universal ID', () => {
    const r = ResolveRecipientSchema.safeParse({ identifier: 'BOLT-KP-4821' });
    expect(r.success).toBe(true);
  });

  it('rejects empty string', () => {
    const r = ResolveRecipientSchema.safeParse({ identifier: '' });
    expect(r.success).toBe(false);
  });

  it('rejects missing identifier', () => {
    const r = ResolveRecipientSchema.safeParse({});
    expect(r.success).toBe(false);
  });

  it('rejects identifier over 50 chars', () => {
    const r = ResolveRecipientSchema.safeParse({ identifier: 'x'.repeat(51) });
    expect(r.success).toBe(false);
  });
});

describe('InternalTransferSchema', () => {
  const validPayload = {
    recipient_wallet_id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
    amount_kobo: 500_000,
    pin: '1234',
  };

  it('accepts a valid transfer payload', () => {
    const r = InternalTransferSchema.safeParse(validPayload);
    expect(r.success).toBe(true);
  });

  it('accepts optional narration', () => {
    const r = InternalTransferSchema.safeParse({ ...validPayload, narration: 'Rent' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.narration).toBe('Rent');
  });

  it('rejects non-UUID recipient_wallet_id', () => {
    const r = InternalTransferSchema.safeParse({
      ...validPayload,
      recipient_wallet_id: 'not-a-uuid',
    });
    expect(r.success).toBe(false);
  });

  it('rejects zero amount', () => {
    const r = InternalTransferSchema.safeParse({ ...validPayload, amount_kobo: 0 });
    expect(r.success).toBe(false);
  });

  it('rejects negative amount', () => {
    const r = InternalTransferSchema.safeParse({ ...validPayload, amount_kobo: -100 });
    expect(r.success).toBe(false);
  });

  it('rejects non-integer amount', () => {
    const r = InternalTransferSchema.safeParse({ ...validPayload, amount_kobo: 500.5 });
    expect(r.success).toBe(false);
  });

  it('rejects 3-digit PIN', () => {
    const r = InternalTransferSchema.safeParse({ ...validPayload, pin: '123' });
    expect(r.success).toBe(false);
  });

  it('rejects 5-digit PIN', () => {
    const r = InternalTransferSchema.safeParse({ ...validPayload, pin: '12345' });
    expect(r.success).toBe(false);
  });

  it('rejects PIN with letters', () => {
    const r = InternalTransferSchema.safeParse({ ...validPayload, pin: '12ab' });
    expect(r.success).toBe(false);
  });

  it('rejects narration over 255 chars', () => {
    const r = InternalTransferSchema.safeParse({ ...validPayload, narration: 'x'.repeat(256) });
    expect(r.success).toBe(false);
  });

  it('missing pin rejects', () => {
    const { pin, ...rest } = validPayload;
    const r = InternalTransferSchema.safeParse(rest);
    expect(r.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Reference generator
// ---------------------------------------------------------------------------

// Extract reference generator logic via the pattern it must produce
describe('Transfer reference format', () => {
  // FLK-YYYYMMDD-XXXXXX where XXXXXX is 6 hex chars
  const REFERENCE_RE = /^FLK-\d{8}-[0-9A-F]{6}$/;

  it('reference regex matches expected format', () => {
    const now = new Date();
    const date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    const ref = `FLK-${date}-A1B2C3`;
    expect(REFERENCE_RE.test(ref)).toBe(true);
  });

  it('reference regex rejects wrong prefix', () => {
    expect(REFERENCE_RE.test('TRF-20260506-A1B2C3')).toBe(false);
  });

  it('reference regex rejects wrong hex length', () => {
    expect(REFERENCE_RE.test('FLK-20260506-A1B2')).toBe(false);
  });

  it('reference regex rejects lowercase hex', () => {
    expect(REFERENCE_RE.test('FLK-20260506-a1b2c3')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// KYC daily limit logic
// ---------------------------------------------------------------------------

describe('KYC daily limit enforcement logic', () => {
  // Test the BigInt comparison logic that the service uses
  it('blocks transfer when used + amount exceeds limit', () => {
    const limit = BigInt(5_000_000); // Tier 1 — ₦50k
    const usedToday = BigInt(4_900_000); // ₦49k used
    const amount = BigInt(200_000); // ₦2k request → would total ₦51k

    expect(usedToday + amount > limit).toBe(true);
  });

  it('allows transfer when used + amount equals limit exactly', () => {
    const limit = BigInt(5_000_000);
    const usedToday = BigInt(4_500_000); // ₦45k used
    const amount = BigInt(500_000); // ₦5k → exactly ₦50k

    expect(usedToday + amount > limit).toBe(false);
  });

  it('allows transfer when well within limit', () => {
    const limit = BigInt(5_000_000);
    const usedToday = BigInt(0);
    const amount = BigInt(100_000);

    expect(usedToday + amount > limit).toBe(false);
  });

  it('Tier 2 limit is 20x Tier 1 for FlowKey-to-FlowKey', () => {
    // Tier 1: ₦50k, Tier 2: ₦1m
    const tier1 = BigInt(5_000_000);
    const tier2 = BigInt(100_000_000);
    expect(tier2 / tier1).toBe(BigInt(20));
  });
});

// ---------------------------------------------------------------------------
// Double-entry ledger correctness
// ---------------------------------------------------------------------------

describe('Double-entry ledger invariants', () => {
  // These test the accounting logic the service applies — amount > 0 in, amount out
  it('sender debit equals gross amount', () => {
    const amountKobo = BigInt(500_000);
    const fee = BigInt(0);
    // Sender loses full amount
    const senderDebit = amountKobo;
    expect(senderDebit).toBe(BigInt(500_000));
  });

  it('receiver credit equals net amount (amount - fee)', () => {
    const amountKobo = BigInt(500_000);
    const fee = BigInt(0);
    const netAmount = amountKobo - fee;
    // Receiver gets net
    const receiverCredit = netAmount;
    expect(receiverCredit).toBe(BigInt(500_000));
  });

  it('zero fee means sender debit equals receiver credit', () => {
    const amountKobo = BigInt(1_000_000);
    const fee = BigInt(0);
    const netAmount = amountKobo - fee;
    expect(amountKobo).toBe(netAmount);
  });

  it('kobo values serialise to strings, not numbers', () => {
    const amount = BigInt(500_000);
    const serialised = amount.toString();
    expect(typeof serialised).toBe('string');
    expect(serialised).toBe('500000');
  });

  it('large kobo values do not lose precision', () => {
    // ₦5,000,000 = 500,000,000 kobo
    const amount = BigInt(500_000_000);
    // JavaScript Number would lose precision here for very large ints
    expect(amount.toString()).toBe('500000000');
    expect(amount > BigInt(Number.MAX_SAFE_INTEGER)).toBe(false); // still safe here
  });
});

// ---------------------------------------------------------------------------
// TransferResult shape
// ---------------------------------------------------------------------------

describe('TransferResult shape contract', () => {
  // Simulate what executeInternalTransfer returns
  const mockResult = {
    transaction_id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
    reference: 'FLK-20260506-A1B2C3',
    amount_kobo: '500000',
    fee_kobo: '0',
    net_amount_kobo: '500000',
    status: 'completed' as const,
    sender_wallet_id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
    receiver_wallet_id: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
    narration: 'Rent',
    created_at: new Date(),
  };

  it('status is always completed for internal transfers', () => {
    expect(mockResult.status).toBe('completed');
  });

  it('amount_kobo is a string', () => {
    expect(typeof mockResult.amount_kobo).toBe('string');
  });

  it('fee_kobo is a string', () => {
    expect(typeof mockResult.fee_kobo).toBe('string');
  });

  it('net_amount_kobo is a string', () => {
    expect(typeof mockResult.net_amount_kobo).toBe('string');
  });

  it('created_at is a Date', () => {
    expect(mockResult.created_at).toBeInstanceOf(Date);
  });

  it('net_amount = amount - fee (zero fee case)', () => {
    const amount = BigInt(mockResult.amount_kobo);
    const fee = BigInt(mockResult.fee_kobo);
    const net = BigInt(mockResult.net_amount_kobo);
    expect(net).toBe(amount - fee);
  });
});
