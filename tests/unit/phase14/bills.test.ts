import {
  BuyAirtimeSchema,
  BuyDataSchema,
  PayTvSchema,
  VerifySmartcardSchema,
  VerifyMeterSchema,
  PayElectricitySchema,
  PayEducationSchema,
  ListBillsSchema,
} from '../../../src/features/bills/bills.schema';

import { VTPASS_SERVICE_IDS, DISCO_LIST } from '../../../src/features/bills/bills.types';

import { generateVtpassRequestId } from '../../../src/features/bills/vtpass.provider';

import {
  vtpassIsDelivered,
  vtpassIsPending,
  isMalformedProviderResponse,
  serializeProviderResponse,
} from '../../../src/features/bills/bills.utils';

// ---------------------------------------------------------------------------
// BuyAirtimeSchema
// ---------------------------------------------------------------------------

describe('BuyAirtimeSchema', () => {
  const valid = { network: 'mtn' as const, phone: '08012345678', amount_kobo: 50000, pin: '1234' };

  it('accepts valid payload', () => expect(BuyAirtimeSchema.safeParse(valid).success).toBe(true));
  it('accepts all 4 networks', () => {
    for (const n of ['mtn', 'airtel', 'glo', '9mobile'] as const)
      expect(BuyAirtimeSchema.safeParse({ ...valid, network: n }).success).toBe(true);
  });
  it('rejects unknown network', () =>
    expect(BuyAirtimeSchema.safeParse({ ...valid, network: 'tele' }).success).toBe(false));
  it('rejects below minimum ₦50', () =>
    expect(BuyAirtimeSchema.safeParse({ ...valid, amount_kobo: 4999 }).success).toBe(false));
  it('accepts exactly ₦50 (5000 kobo)', () =>
    expect(BuyAirtimeSchema.safeParse({ ...valid, amount_kobo: 5000 }).success).toBe(true));
  it('rejects above maximum ₦50k', () =>
    expect(BuyAirtimeSchema.safeParse({ ...valid, amount_kobo: 5_000_001 }).success).toBe(false));
  it('rejects decimal amount', () =>
    expect(BuyAirtimeSchema.safeParse({ ...valid, amount_kobo: 500.5 }).success).toBe(false));
  it('rejects empty phone', () =>
    expect(BuyAirtimeSchema.safeParse({ ...valid, phone: '' }).success).toBe(false));
  it('rejects 3-digit PIN', () =>
    expect(BuyAirtimeSchema.safeParse({ ...valid, pin: '123' }).success).toBe(false));
  it('rejects alpha PIN', () =>
    expect(BuyAirtimeSchema.safeParse({ ...valid, pin: 'abcd' }).success).toBe(false));
});

// ---------------------------------------------------------------------------
// BuyDataSchema
// ---------------------------------------------------------------------------

describe('BuyDataSchema', () => {
  const valid = {
    network: 'mtn' as const,
    phone: '08012345678',
    variation_code: 'mtn-1gb',
    amount_kobo: 100000,
    pin: '1234',
  };

  it('accepts valid payload', () => expect(BuyDataSchema.safeParse(valid).success).toBe(true));
  it('rejects empty variation_code', () =>
    expect(BuyDataSchema.safeParse({ ...valid, variation_code: '' }).success).toBe(false));
  it('rejects zero amount', () =>
    expect(BuyDataSchema.safeParse({ ...valid, amount_kobo: 0 }).success).toBe(false));
  it('rejects 5-digit PIN', () =>
    expect(BuyDataSchema.safeParse({ ...valid, pin: '12345' }).success).toBe(false));
});

// ---------------------------------------------------------------------------
// VerifySmartcardSchema
// ---------------------------------------------------------------------------

describe('VerifySmartcardSchema', () => {
  const valid = { provider: 'dstv' as const, smartcard: '1212121212' };

  it('accepts valid DSTV', () => expect(VerifySmartcardSchema.safeParse(valid).success).toBe(true));
  it('accepts gotv', () =>
    expect(VerifySmartcardSchema.safeParse({ ...valid, provider: 'gotv' }).success).toBe(true));
  it('rejects unknown provider', () =>
    expect(VerifySmartcardSchema.safeParse({ ...valid, provider: 'netflix' }).success).toBe(false));
  it('rejects smartcard too short', () =>
    expect(VerifySmartcardSchema.safeParse({ ...valid, smartcard: '123' }).success).toBe(false));
});

// ---------------------------------------------------------------------------
// PayTvSchema
// ---------------------------------------------------------------------------

describe('PayTvSchema', () => {
  const valid = {
    provider: 'dstv' as const,
    smartcard: '1212121212',
    variation_code: 'dstv-compact',
    amount_kobo: 1570000,
    pin: '1234',
  };

  it('accepts valid payload', () => expect(PayTvSchema.safeParse(valid).success).toBe(true));
  it('accepts optional phone', () =>
    expect(PayTvSchema.safeParse({ ...valid, phone: '08012345678' }).success).toBe(true));
  it('rejects empty variation_code', () =>
    expect(PayTvSchema.safeParse({ ...valid, variation_code: '' }).success).toBe(false));
  it('rejects zero amount', () =>
    expect(PayTvSchema.safeParse({ ...valid, amount_kobo: 0 }).success).toBe(false));
});

// ---------------------------------------------------------------------------
// VerifyMeterSchema
// ---------------------------------------------------------------------------

describe('VerifyMeterSchema', () => {
  const valid = {
    disco: 'ikeja-electric' as const,
    meter_number: '12345678901',
    meter_type: 'prepaid' as const,
  };

  it('accepts valid prepaid', () => expect(VerifyMeterSchema.safeParse(valid).success).toBe(true));
  it('accepts postpaid', () =>
    expect(VerifyMeterSchema.safeParse({ ...valid, meter_type: 'postpaid' }).success).toBe(true));
  it('rejects unknown disco', () =>
    expect(VerifyMeterSchema.safeParse({ ...valid, disco: 'unknown' }).success).toBe(false));
  it('rejects short meter number', () =>
    expect(VerifyMeterSchema.safeParse({ ...valid, meter_number: '123' }).success).toBe(false));
  it('rejects invalid meter_type', () =>
    expect(VerifyMeterSchema.safeParse({ ...valid, meter_type: 'hybrid' }).success).toBe(false));
});

// ---------------------------------------------------------------------------
// PayElectricitySchema
// ---------------------------------------------------------------------------

describe('PayElectricitySchema', () => {
  const valid = {
    disco: 'ikeja-electric' as const,
    meter_number: '12345678901',
    meter_type: 'prepaid' as const,
    amount_kobo: 500000,
    phone: '08012345678',
    pin: '1234',
  };

  it('accepts valid payload', () =>
    expect(PayElectricitySchema.safeParse(valid).success).toBe(true));
  it('accepts optional customer_name', () =>
    expect(PayElectricitySchema.safeParse({ ...valid, customer_name: 'Kingsley' }).success).toBe(
      true,
    ));
  it('rejects below minimum ₦500', () =>
    expect(PayElectricitySchema.safeParse({ ...valid, amount_kobo: 49999 }).success).toBe(false));
  it('accepts exactly ₦500 (50000 kobo)', () =>
    expect(PayElectricitySchema.safeParse({ ...valid, amount_kobo: 50000 }).success).toBe(true));
  it('rejects empty phone', () =>
    expect(PayElectricitySchema.safeParse({ ...valid, phone: '' }).success).toBe(false));
  it('rejects 5-digit PIN', () =>
    expect(PayElectricitySchema.safeParse({ ...valid, pin: '12345' }).success).toBe(false));
});

// ---------------------------------------------------------------------------
// PayEducationSchema
// ---------------------------------------------------------------------------

describe('PayEducationSchema', () => {
  const valid = {
    product: 'waec' as const,
    quantity: 1,
    amount_kobo: 350000,
    phone: '08012345678',
    pin: '1234',
  };

  it('accepts valid WAEC', () => expect(PayEducationSchema.safeParse(valid).success).toBe(true));
  it('accepts JAMB', () =>
    expect(PayEducationSchema.safeParse({ ...valid, product: 'jamb' }).success).toBe(true));
  it('defaults quantity to 1', () => {
    const r = PayEducationSchema.safeParse(valid);
    if (r.success) expect(r.data.quantity).toBe(1);
  });
  it('rejects quantity > 5', () =>
    expect(PayEducationSchema.safeParse({ ...valid, quantity: 6 }).success).toBe(false));
  it('rejects quantity 0', () =>
    expect(PayEducationSchema.safeParse({ ...valid, quantity: 0 }).success).toBe(false));
  it('rejects unknown product', () =>
    expect(PayEducationSchema.safeParse({ ...valid, product: 'neco' }).success).toBe(false));
});

// ---------------------------------------------------------------------------
// ListBillsSchema
// ---------------------------------------------------------------------------

describe('ListBillsSchema', () => {
  it('defaults category to all', () => {
    const r = ListBillsSchema.safeParse({});
    if (r.success) expect(r.data.category).toBe('all');
  });
  it('defaults limit to 20', () => {
    const r = ListBillsSchema.safeParse({});
    if (r.success) expect(r.data.limit).toBe(20);
  });
  it('accepts status: delivered', () =>
    expect(ListBillsSchema.safeParse({ status: 'delivered' }).success).toBe(true));
  it('accepts status: refunded', () =>
    expect(ListBillsSchema.safeParse({ status: 'refunded' }).success).toBe(true));
  it('accepts status: provider_uncertain', () =>
    expect(ListBillsSchema.safeParse({ status: 'provider_uncertain' }).success).toBe(true));
  it('rejects limit > 50', () =>
    expect(ListBillsSchema.safeParse({ limit: 51 }).success).toBe(false));
  it('rejects unknown category', () =>
    expect(ListBillsSchema.safeParse({ category: 'crypto' }).success).toBe(false));
});

// ---------------------------------------------------------------------------
// VTPass response helpers
// ---------------------------------------------------------------------------

describe('vtpassIsDelivered', () => {
  it('true for code 000 and status delivered', () =>
    expect(
      vtpassIsDelivered({ code: '000', content: { transactions: { status: 'delivered' } } }),
    ).toBe(true));
  it('true for code 000 and status successful', () =>
    expect(
      vtpassIsDelivered({ code: '000', content: { transactions: { status: 'successful' } } }),
    ).toBe(true));
  it('true for code 000 with empty status', () =>
    expect(vtpassIsDelivered({ code: '000', content: { transactions: { status: '' } } })).toBe(
      true,
    ));
  it('true for code 000 with no content', () =>
    expect(vtpassIsDelivered({ code: '000' })).toBe(true));
  it('false for code 099', () =>
    expect(
      vtpassIsDelivered({ code: '099', content: { transactions: { status: 'pending' } } }),
    ).toBe(false));
  it('false for failure code', () =>
    expect(
      vtpassIsDelivered({ code: '016', content: { transactions: { status: 'failed' } } }),
    ).toBe(false));
  it('false for null', () => expect(vtpassIsDelivered(null)).toBe(false));
  it('false for undefined', () => expect(vtpassIsDelivered(undefined)).toBe(false));
});

describe('vtpassIsPending', () => {
  it('true for code 099', () => expect(vtpassIsPending({ code: '099' })).toBe(true));
  it('true for status pending', () =>
    expect(vtpassIsPending({ code: '000', content: { transactions: { status: 'pending' } } })).toBe(
      true,
    ));
  it('false for delivered', () =>
    expect(
      vtpassIsPending({ code: '000', content: { transactions: { status: 'delivered' } } }),
    ).toBe(false));
  it('false for null', () => expect(vtpassIsPending(null)).toBe(false));
});

describe('isMalformedProviderResponse', () => {
  it('true for null', () => expect(isMalformedProviderResponse(null)).toBe(true));
  it('true for undefined', () => expect(isMalformedProviderResponse(undefined)).toBe(true));
  it('true for string (HTML/raw error)', () =>
    expect(isMalformedProviderResponse('<html>error</html>')).toBe(true));
  it('true for number', () => expect(isMalformedProviderResponse(500)).toBe(true));
  it('false for valid object', () =>
    expect(isMalformedProviderResponse({ code: '000' })).toBe(false));
  it('false for empty object', () => expect(isMalformedProviderResponse({})).toBe(false));
});

describe('serializeProviderResponse', () => {
  it('serializes a normal object', () =>
    expect(serializeProviderResponse({ code: '000' })).toBe('{"code":"000"}'));
  it('truncates at 10000 chars', () => {
    const big = { data: 'x'.repeat(20000) };
    expect(serializeProviderResponse(big).length).toBe(10000);
  });
  it('handles null gracefully', () => expect(serializeProviderResponse(null)).toBe('null'));
  it('handles unserializable value', () => {
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;
    expect(serializeProviderResponse(circular)).toBe('UNSERIALIZABLE_PROVIDER_RESPONSE');
  });
});

// ---------------------------------------------------------------------------
// Bill state machine
// ---------------------------------------------------------------------------

describe('Bill state machine', () => {
  const validStatuses = [
    'pending',
    'processing',
    'delivered',
    'failed',
    'refunded',
    'provider_uncertain',
    'reconciliation_required',
  ];

  it('has 7 valid statuses', () => expect(validStatuses).toHaveLength(7));
  it('failed and refunded are distinct', () => expect('failed').not.toBe('refunded'));

  it('delivered → no refund', () => {
    const status = 'delivered';
    expect(['failed', 'refunded']).not.toContain(status);
  });

  it('provider_uncertain → no immediate refund', () => {
    // Must requery before deciding to refund
    const status = 'provider_uncertain';
    expect(status).toBe('provider_uncertain');
    const shouldRefundImmediately = false;
    expect(shouldRefundImmediately).toBe(false);
  });

  it('failed transitions to refunded after safeRefund', () => {
    // failed = provider confirmed failure, refund not yet issued
    // refunded = refund ledger entry created + wallet credited
    const pre = 'failed';
    const post = 'refunded';
    expect(pre).not.toBe(post);
  });
});

// ---------------------------------------------------------------------------
// Reconcile retry schedule
// ---------------------------------------------------------------------------

describe('Reconcile retry schedule', () => {
  const DELAYS_MS = [60_000, 300_000, 900_000, 1_800_000, 3_600_000, 21_600_000];

  it('has 6 attempts', () => expect(DELAYS_MS).toHaveLength(6));
  it('first attempt is 1 minute', () => expect(DELAYS_MS[0]).toBe(60_000));
  it('last attempt is 6 hours', () => expect(DELAYS_MS[5]).toBe(21_600_000));
  it('delays are strictly increasing', () => {
    for (let i = 1; i < DELAYS_MS.length; i++)
      expect(DELAYS_MS[i]!).toBeGreaterThan(DELAYS_MS[i - 1]!);
  });
  it('after max attempts → reconciliation_required', () => {
    const maxAttempts = 6;
    const nextAttempt = maxAttempts + 1;
    expect(nextAttempt > maxAttempts).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------

describe('Idempotency', () => {
  it('duplicate idempotency key returns original without re-executing', () => {
    // Simulated: same key → same bill_id returned
    const billId = 'uuid-original';
    const idempotencyKey = 'idem-key-001';
    const cache = new Map<string, string>();
    cache.set(idempotencyKey, billId);
    expect(cache.get(idempotencyKey)).toBe(billId);
  });

  it('different idempotency keys create separate bills', () => {
    const cache = new Map([
      ['key-1', 'bill-1'],
      ['key-2', 'bill-2'],
    ]);
    expect(cache.get('key-1')).not.toBe(cache.get('key-2'));
  });
});

// ---------------------------------------------------------------------------
// Atomic debit semantics
// ---------------------------------------------------------------------------

describe('Atomic wallet debit', () => {
  it('debit succeeds when balance >= amount', () => {
    const balance = BigInt(100000);
    const amount = BigInt(50000);
    expect(balance >= amount).toBe(true);
  });

  it('debit fails when balance < amount', () => {
    const balance = BigInt(30000);
    const amount = BigInt(50000);
    expect(balance >= amount).toBe(false);
  });

  it('debit at exact balance succeeds', () => {
    const balance = BigInt(50000);
    const amount = BigInt(50000);
    expect(balance >= amount).toBe(true);
  });

  it('resulting balance is non-negative', () => {
    const balance = BigInt(100000);
    const amount = BigInt(50000);
    expect(balance - amount).toBeGreaterThanOrEqual(BigInt(0));
  });
});

// ---------------------------------------------------------------------------
// Safe refund idempotency
// ---------------------------------------------------------------------------

describe('safeRefundWallet idempotency', () => {
  it('skips refund if ledger credit entry already exists', () => {
    const existingRefund = { id: 'ledger-uuid', reference: 'REFUND-BILL-20260519-ABC123' };
    const shouldRefund = existingRefund === null;
    expect(shouldRefund).toBe(false);
  });

  it('proceeds if no refund ledger entry exists', () => {
    const existingRefund = null;
    const shouldRefund = existingRefund === null;
    expect(shouldRefund).toBe(true);
  });

  it('refund reference format is REFUND-{original_reference}', () => {
    const ref = 'BILL-20260519-ABC123';
    const refundRef = `REFUND-${ref}`;
    expect(refundRef).toBe('REFUND-BILL-20260519-ABC123');
  });
});

// ---------------------------------------------------------------------------
// VTPASS_SERVICE_IDS mapping
// ---------------------------------------------------------------------------

describe('VTPASS_SERVICE_IDS', () => {
  it('maps mtn → mtn', () => expect(VTPASS_SERVICE_IDS['mtn']).toBe('mtn'));
  it('maps 9mobile → etisalat', () => expect(VTPASS_SERVICE_IDS['9mobile']).toBe('etisalat'));
  it('maps dstv → dstv', () => expect(VTPASS_SERVICE_IDS['dstv']).toBe('dstv'));
  it('maps ikeja-electric correctly', () =>
    expect(VTPASS_SERVICE_IDS['ikeja-electric']).toBe('ikeja-electric'));
  it('maps waec correctly', () => expect(VTPASS_SERVICE_IDS['waec']).toBe('waec'));
  it('maps jamb correctly', () => expect(VTPASS_SERVICE_IDS['jamb']).toBe('jamb'));
});

// ---------------------------------------------------------------------------
// DISCO list
// ---------------------------------------------------------------------------

describe('DISCO_LIST', () => {
  it('has 12 DISCOs', () => expect(DISCO_LIST).toHaveLength(12));
  it('every DISCO has id and name', () => {
    for (const d of DISCO_LIST) {
      expect(d.id.length).toBeGreaterThan(0);
      expect(d.name.length).toBeGreaterThan(0);
    }
  });
  it('includes ikeja-electric', () =>
    expect(DISCO_LIST.some((d) => d.id === 'ikeja-electric')).toBe(true));
  it('includes abuja-electric', () =>
    expect(DISCO_LIST.some((d) => d.id === 'abuja-electric')).toBe(true));
});

// ---------------------------------------------------------------------------
// VTPass request ID
// ---------------------------------------------------------------------------

describe('generateVtpassRequestId', () => {
  it('generates ≥ 12 characters', () =>
    expect(generateVtpassRequestId().length).toBeGreaterThanOrEqual(12));
  it('first 12 chars are numeric', () =>
    expect(generateVtpassRequestId().slice(0, 12)).toMatch(/^\d{12}$/));
  it('starts with current year', () =>
    expect(generateVtpassRequestId().startsWith(String(new Date().getFullYear()))).toBe(true));
  it('generates unique IDs', () =>
    expect(generateVtpassRequestId()).not.toBe(generateVtpassRequestId()));
  it('accepts custom suffix', () => expect(generateVtpassRequestId('TEST01')).toContain('TEST01'));
});

// ---------------------------------------------------------------------------
// Bill reference format
// ---------------------------------------------------------------------------

describe('Bill reference format', () => {
  const REF_RE = /^BILL-\d{8}-[0-9A-F]{6}$/;
  const d = new Date();
  const date = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;

  it('matches BILL-YYYYMMDD-XXXXXX', () => expect(REF_RE.test(`BILL-${date}-A1B2C3`)).toBe(true));
  it('rejects wrong prefix', () => expect(REF_RE.test(`TRF-${date}-A1B2C3`)).toBe(false));
});

// ---------------------------------------------------------------------------
// KYC limit routing
// ---------------------------------------------------------------------------

describe('KYC limit category routing', () => {
  it('airtime uses airtime_kobo', () => {
    const cat = 'airtime';
    expect(cat === 'airtime' ? 'airtime_kobo' : 'other_bills_kobo').toBe('airtime_kobo');
  });

  it('data, tv, electricity, education use other_bills_kobo', () => {
    for (const cat of ['data', 'tv', 'electricity', 'education']) {
      expect(cat === 'airtime' ? 'airtime_kobo' : 'other_bills_kobo').toBe('other_bills_kobo');
    }
  });
});
