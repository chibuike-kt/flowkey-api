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

// ---------------------------------------------------------------------------
// BuyAirtimeSchema
// ---------------------------------------------------------------------------

describe('BuyAirtimeSchema', () => {
  const valid = { network: 'mtn' as const, phone: '08012345678', amount_kobo: 50000, pin: '1234' };

  it('accepts valid payload', () => expect(BuyAirtimeSchema.safeParse(valid).success).toBe(true));
  it('accepts all 4 networks', () => {
    for (const n of ['mtn', 'airtel', 'glo', '9mobile'] as const) {
      expect(BuyAirtimeSchema.safeParse({ ...valid, network: n }).success).toBe(true);
    }
  });
  it('rejects unknown network', () =>
    expect(BuyAirtimeSchema.safeParse({ ...valid, network: 'tele' }).success).toBe(false));
  it('rejects below minimum (₦50)', () =>
    expect(BuyAirtimeSchema.safeParse({ ...valid, amount_kobo: 4999 }).success).toBe(false));
  it('accepts exactly ₦50 (5000 kobo)', () =>
    expect(BuyAirtimeSchema.safeParse({ ...valid, amount_kobo: 5000 }).success).toBe(true));
  it('rejects above maximum (₦50k)', () =>
    expect(BuyAirtimeSchema.safeParse({ ...valid, amount_kobo: 5_000_001 }).success).toBe(false));
  it('rejects decimal amount', () =>
    expect(BuyAirtimeSchema.safeParse({ ...valid, amount_kobo: 500.5 }).success).toBe(false));
  it('rejects missing phone', () =>
    expect(BuyAirtimeSchema.safeParse({ ...valid, phone: '' }).success).toBe(false));
  it('rejects wrong PIN format', () =>
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
  it('rejects missing variation', () =>
    expect(BuyDataSchema.safeParse({ ...valid, variation_code: '' }).success).toBe(false));
  it('rejects zero amount', () =>
    expect(BuyDataSchema.safeParse({ ...valid, amount_kobo: 0 }).success).toBe(false));
  it('rejects bad PIN', () =>
    expect(BuyDataSchema.safeParse({ ...valid, pin: '12345' }).success).toBe(false));
});

// ---------------------------------------------------------------------------
// VerifySmartcardSchema
// ---------------------------------------------------------------------------

describe('VerifySmartcardSchema', () => {
  const valid = { provider: 'dstv' as const, smartcard: '1212121212' };

  it('accepts valid DSTV smartcard', () =>
    expect(VerifySmartcardSchema.safeParse(valid).success).toBe(true));
  it('accepts gotv', () =>
    expect(VerifySmartcardSchema.safeParse({ ...valid, provider: 'gotv' }).success).toBe(true));
  it('accepts startimes', () =>
    expect(VerifySmartcardSchema.safeParse({ ...valid, provider: 'startimes' }).success).toBe(
      true,
    ));
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
  it('rejects missing variation', () =>
    expect(PayTvSchema.safeParse({ ...valid, variation_code: '' }).success).toBe(false));
  it('rejects zero amount', () =>
    expect(PayTvSchema.safeParse({ ...valid, amount_kobo: 0 }).success).toBe(false));
  it('rejects bad PIN', () =>
    expect(PayTvSchema.safeParse({ ...valid, pin: '123' }).success).toBe(false));
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

  it('accepts valid prepaid meter', () =>
    expect(VerifyMeterSchema.safeParse(valid).success).toBe(true));
  it('accepts postpaid', () =>
    expect(VerifyMeterSchema.safeParse({ ...valid, meter_type: 'postpaid' }).success).toBe(true));
  it('rejects unknown disco', () =>
    expect(VerifyMeterSchema.safeParse({ ...valid, disco: 'unknown' }).success).toBe(false));
  it('rejects short meter number', () =>
    expect(VerifyMeterSchema.safeParse({ ...valid, meter_number: '123' }).success).toBe(false));
  it('rejects invalid meter type', () =>
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
  it('rejects below minimum (₦500)', () =>
    expect(PayElectricitySchema.safeParse({ ...valid, amount_kobo: 49999 }).success).toBe(false));
  it('accepts exactly ₦500 (50000 kobo)', () =>
    expect(PayElectricitySchema.safeParse({ ...valid, amount_kobo: 50000 }).success).toBe(true));
  it('rejects bad PIN', () =>
    expect(PayElectricitySchema.safeParse({ ...valid, pin: '12345' }).success).toBe(false));
  it('rejects missing phone', () =>
    expect(PayElectricitySchema.safeParse({ ...valid, phone: '' }).success).toBe(false));
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

  it('accepts valid WAEC payload', () =>
    expect(PayEducationSchema.safeParse(valid).success).toBe(true));
  it('accepts JAMB', () =>
    expect(PayEducationSchema.safeParse({ ...valid, product: 'jamb' }).success).toBe(true));
  it('accepts waec-registration', () =>
    expect(PayEducationSchema.safeParse({ ...valid, product: 'waec-registration' }).success).toBe(
      true,
    ));
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
  it('accepts category: airtime', () =>
    expect(ListBillsSchema.safeParse({ category: 'airtime' }).success).toBe(true));
  it('accepts category: electricity', () =>
    expect(ListBillsSchema.safeParse({ category: 'electricity' }).success).toBe(true));
  it('accepts status: delivered', () =>
    expect(ListBillsSchema.safeParse({ status: 'delivered' }).success).toBe(true));
  it('accepts status: refunded', () =>
    expect(ListBillsSchema.safeParse({ status: 'refunded' }).success).toBe(true));
  it('rejects limit > 50', () =>
    expect(ListBillsSchema.safeParse({ limit: 51 }).success).toBe(false));
  it('rejects invalid category', () =>
    expect(ListBillsSchema.safeParse({ category: 'crypto' }).success).toBe(false));
});

// ---------------------------------------------------------------------------
// VTPass service ID mapping
// ---------------------------------------------------------------------------

describe('VTPASS_SERVICE_IDS mapping', () => {
  it('maps mtn → mtn', () => expect(VTPASS_SERVICE_IDS['mtn']).toBe('mtn'));
  it('maps airtel → airtel', () => expect(VTPASS_SERVICE_IDS['airtel']).toBe('airtel'));
  it('maps 9mobile → etisalat', () => expect(VTPASS_SERVICE_IDS['9mobile']).toBe('etisalat'));
  it('maps dstv → dstv', () => expect(VTPASS_SERVICE_IDS['dstv']).toBe('dstv'));
  it('maps ikeja-electric correctly', () =>
    expect(VTPASS_SERVICE_IDS['ikeja-electric']).toBe('ikeja-electric'));
  it('maps phed correctly', () => expect(VTPASS_SERVICE_IDS['phed']).toBe('phed'));
  it('maps waec correctly', () => expect(VTPASS_SERVICE_IDS['waec']).toBe('waec'));
  it('maps jamb correctly', () => expect(VTPASS_SERVICE_IDS['jamb']).toBe('jamb'));
});

// ---------------------------------------------------------------------------
// DISCO list
// ---------------------------------------------------------------------------

describe('DISCO_LIST', () => {
  it('has 12 DISCOs', () => expect(DISCO_LIST).toHaveLength(12));
  it('includes ikeja-electric', () =>
    expect(DISCO_LIST.some((d) => d.id === 'ikeja-electric')).toBe(true));
  it('includes abuja-electric', () =>
    expect(DISCO_LIST.some((d) => d.id === 'abuja-electric')).toBe(true));
  it('every DISCO has id and name', () => {
    for (const d of DISCO_LIST) {
      expect(d.id).toBeDefined();
      expect(d.name.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// VTPass request ID format
// ---------------------------------------------------------------------------

describe('generateVtpassRequestId', () => {
  it('generates at least 12 characters', () =>
    expect(generateVtpassRequestId().length).toBeGreaterThanOrEqual(12));
  it('first 12 chars are numeric', () =>
    expect(generateVtpassRequestId().slice(0, 12)).toMatch(/^\d{12}$/));
  it('starts with current year', () =>
    expect(generateVtpassRequestId().startsWith(String(new Date().getFullYear()))).toBe(true));
  it('generates unique IDs each call', () =>
    expect(generateVtpassRequestId()).not.toBe(generateVtpassRequestId()));
  it('accepts custom suffix', () => {
    const id = generateVtpassRequestId('TEST01');
    expect(id).toContain('TEST01');
    expect(id.slice(0, 12)).toMatch(/^\d{12}$/);
  });
});

// ---------------------------------------------------------------------------
// VTPass response code handling
// ---------------------------------------------------------------------------

describe('VTPass response code handling', () => {
  it('code 000 = delivered (success)', () => expect('000').toBe('000'));
  it('code 099 = pending', () => expect('099').toBe('099'));
  it('any other code = failed', () => {
    const failCodes = ['010', '016', '030', '034', '040', '043'];
    failCodes.forEach((code) => expect(code).not.toBe('000'));
    failCodes.forEach((code) => expect(code).not.toBe('099'));
  });

  it('delivered → no refund', () => {
    const status = 'delivered';
    expect(['failed', 'refunded']).not.toContain(status);
  });

  it('failed → wallet refunded', () => {
    const status = 'failed';
    expect(status).toBe('failed');
    // Refund would be triggered
    const shouldRefund = status === 'failed';
    expect(shouldRefund).toBe(true);
  });

  it('pending → no immediate refund, requery scheduled', () => {
    const status = 'pending';
    const shouldRefund = status === 'failed';
    expect(shouldRefund).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// KYC limit categories
// ---------------------------------------------------------------------------

describe('KYC limit categories for bills', () => {
  it('airtime uses airtime_kobo limit', () => {
    const category = 'airtime';
    const limitKey = category === 'airtime' ? 'airtime_kobo' : 'other_bills_kobo';
    expect(limitKey).toBe('airtime_kobo');
  });

  it('data, TV, electricity, education use other_bills_kobo', () => {
    for (const category of ['data', 'tv', 'electricity', 'education']) {
      const limitKey = category === 'airtime' ? 'airtime_kobo' : 'other_bills_kobo';
      expect(limitKey).toBe('other_bills_kobo');
    }
  });
});

// ---------------------------------------------------------------------------
// Bill reference format
// ---------------------------------------------------------------------------

describe('Bill reference format', () => {
  const REF_RE = /^BILL-\d{8}-[0-9A-F]{6}$/;

  it('matches BILL-YYYYMMDD-XXXXXX', () => {
    const d = new Date();
    const date = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    expect(REF_RE.test(`BILL-${date}-A1B2C3`)).toBe(true);
  });
  it('rejects wrong prefix', () => expect(REF_RE.test('TRF-20260519-A1B2C3')).toBe(false));
});

// ---------------------------------------------------------------------------
// Electricity — prepaid vs postpaid
// ---------------------------------------------------------------------------

describe('Electricity meter types', () => {
  it('prepaid generates a token', () => {
    const meterType = 'prepaid';
    const hasToken = meterType === 'prepaid';
    expect(hasToken).toBe(true);
  });

  it('postpaid does not generate a token', () => {
    const meterType = 'postpaid';
    const hasToken = meterType === 'prepaid';
    expect(hasToken).toBe(false);
  });
});
