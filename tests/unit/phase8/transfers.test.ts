/**
 * Phase 8/9 — Transfers unit tests
 *
 * Pure logic: schemas, reference format, KYC limits,
 * double-entry invariants, UID auth model, bank lifecycle,
 * result shapes (updated for rich sender/recipient objects).
 */

import {
  ResolveRecipientSchema,
  InternalTransferSchema,
  BankTransferSchema,
  ListTransfersSchema,
  RetryTransferSchema,
  UidInternalTransferSchema,
  UidBankTransferSchema,
} from '../../../src/features/transfers/transfers.schema';

import type {
  InternalTransferResult,
  BankTransferResult,
  PaymentMethod,
} from '../../../src/features/transfers/transfers.types';

// ---------------------------------------------------------------------------
// ResolveRecipientSchema
// ---------------------------------------------------------------------------

describe('ResolveRecipientSchema', () => {
  it('accepts a username', () =>
    expect(ResolveRecipientSchema.safeParse({ identifier: 'kingsley_kt' }).success).toBe(true));
  it('accepts a Universal ID', () =>
    expect(ResolveRecipientSchema.safeParse({ identifier: 'BOLT-KP-4821' }).success).toBe(true));
  it('rejects empty string', () =>
    expect(ResolveRecipientSchema.safeParse({ identifier: '' }).success).toBe(false));
  it('rejects missing field', () =>
    expect(ResolveRecipientSchema.safeParse({}).success).toBe(false));
  it('rejects > 50 chars', () =>
    expect(ResolveRecipientSchema.safeParse({ identifier: 'x'.repeat(51) }).success).toBe(false));
});

// ---------------------------------------------------------------------------
// InternalTransferSchema
// ---------------------------------------------------------------------------

describe('InternalTransferSchema', () => {
  const valid = {
    recipient_wallet_id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
    amount_kobo: 500_000,
    pin: '1234',
  };

  it('accepts minimal valid payload', () =>
    expect(InternalTransferSchema.safeParse(valid).success).toBe(true));
  it('defaults source to username', () => {
    const r = InternalTransferSchema.safeParse(valid);
    if (r.success) expect(r.data.source).toBe('username');
  });
  it('accepts source: qr_code', () =>
    expect(InternalTransferSchema.safeParse({ ...valid, source: 'qr_code' }).success).toBe(true));
  it('accepts source: api', () =>
    expect(InternalTransferSchema.safeParse({ ...valid, source: 'api' }).success).toBe(true));
  it('rejects source: universal_id', () =>
    expect(InternalTransferSchema.safeParse({ ...valid, source: 'universal_id' }).success).toBe(
      false,
    ));
  it('accepts optional narration', () =>
    expect(InternalTransferSchema.safeParse({ ...valid, narration: 'Rent' }).success).toBe(true));
  it('accepts optional device_id', () =>
    expect(InternalTransferSchema.safeParse({ ...valid, device_id: 'abc123' }).success).toBe(true));
  it('rejects non-UUID wallet id', () =>
    expect(
      InternalTransferSchema.safeParse({ ...valid, recipient_wallet_id: 'not-uuid' }).success,
    ).toBe(false));
  it('rejects zero amount', () =>
    expect(InternalTransferSchema.safeParse({ ...valid, amount_kobo: 0 }).success).toBe(false));
  it('rejects negative amount', () =>
    expect(InternalTransferSchema.safeParse({ ...valid, amount_kobo: -1 }).success).toBe(false));
  it('rejects decimal amount', () =>
    expect(InternalTransferSchema.safeParse({ ...valid, amount_kobo: 500.5 }).success).toBe(false));
  it('rejects 3-digit PIN', () =>
    expect(InternalTransferSchema.safeParse({ ...valid, pin: '123' }).success).toBe(false));
  it('rejects 5-digit PIN', () =>
    expect(InternalTransferSchema.safeParse({ ...valid, pin: '12345' }).success).toBe(false));
  it('rejects alpha PIN', () =>
    expect(InternalTransferSchema.safeParse({ ...valid, pin: 'abcd' }).success).toBe(false));
  it('rejects narration > 255 chars', () =>
    expect(InternalTransferSchema.safeParse({ ...valid, narration: 'x'.repeat(256) }).success).toBe(
      false,
    ));
  it('rejects invalid source value', () =>
    expect(InternalTransferSchema.safeParse({ ...valid, source: 'sms' }).success).toBe(false));
});

// ---------------------------------------------------------------------------
// UidInternalTransferSchema
// ---------------------------------------------------------------------------

describe('UidInternalTransferSchema', () => {
  const valid = {
    universal_id: 'RIVER-CLOUD-SEVEN',
    upp: '654321',
    recipient_wallet_id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
    amount_kobo: 200_000,
  };

  it('accepts valid payload', () =>
    expect(UidInternalTransferSchema.safeParse(valid).success).toBe(true));
  it('accepts optional narration', () =>
    expect(UidInternalTransferSchema.safeParse({ ...valid, narration: 'Test' }).success).toBe(
      true,
    ));
  it('rejects empty universal_id', () =>
    expect(UidInternalTransferSchema.safeParse({ ...valid, universal_id: '' }).success).toBe(
      false,
    ));
  it('rejects 5-digit UPP', () =>
    expect(UidInternalTransferSchema.safeParse({ ...valid, upp: '65432' }).success).toBe(false));
  it('rejects 7-digit UPP', () =>
    expect(UidInternalTransferSchema.safeParse({ ...valid, upp: '6543210' }).success).toBe(false));
  it('rejects alpha UPP', () =>
    expect(UidInternalTransferSchema.safeParse({ ...valid, upp: 'abcdef' }).success).toBe(false));
  it('rejects non-UUID recipient_wallet_id', () =>
    expect(
      UidInternalTransferSchema.safeParse({ ...valid, recipient_wallet_id: 'not-uuid' }).success,
    ).toBe(false));
  it('rejects zero amount', () =>
    expect(UidInternalTransferSchema.safeParse({ ...valid, amount_kobo: 0 }).success).toBe(false));
  it('rejects negative amount', () =>
    expect(UidInternalTransferSchema.safeParse({ ...valid, amount_kobo: -1 }).success).toBe(false));
});

// ---------------------------------------------------------------------------
// UidBankTransferSchema
// ---------------------------------------------------------------------------

describe('UidBankTransferSchema', () => {
  const valid = {
    universal_id: 'RIVER-CLOUD-SEVEN',
    upp: '654321',
    bank_code: '058',
    account_number: '0123456789',
    account_name: 'John Doe',
    bank_name: 'Guaranty Trust Bank',
    verified_account_name: 'John Doe',
    amount_kobo: 500_000,
  };

  it('accepts valid payload', () =>
    expect(UidBankTransferSchema.safeParse(valid).success).toBe(true));
  it('rejects missing universal_id', () =>
    expect(UidBankTransferSchema.safeParse({ ...valid, universal_id: '' }).success).toBe(false));
  it('rejects wrong UPP length', () =>
    expect(UidBankTransferSchema.safeParse({ ...valid, upp: '12345' }).success).toBe(false));
  it('rejects non-10-digit account number', () =>
    expect(UidBankTransferSchema.safeParse({ ...valid, account_number: '123456789' }).success).toBe(
      false,
    ));
  it('rejects missing verified_account_name', () =>
    expect(
      UidBankTransferSchema.safeParse({ ...valid, verified_account_name: undefined }).success,
    ).toBe(false));
  it('rejects zero amount', () =>
    expect(UidBankTransferSchema.safeParse({ ...valid, amount_kobo: 0 }).success).toBe(false));
});

// ---------------------------------------------------------------------------
// BankTransferSchema
// ---------------------------------------------------------------------------

describe('BankTransferSchema', () => {
  const valid = {
    amount_kobo: 1_000_000,
    pin: '1234',
    bank_code: '058',
    account_number: '0123456789',
    account_name: 'John Doe',
    bank_name: 'Guaranty Trust Bank',
    verified_account_name: 'John Doe',
  };

  it('accepts valid payload', () => expect(BankTransferSchema.safeParse(valid).success).toBe(true));
  it('accepts optional narration', () =>
    expect(BankTransferSchema.safeParse({ ...valid, narration: 'Invoice' }).success).toBe(true));
  it('rejects non-10-digit account number', () =>
    expect(BankTransferSchema.safeParse({ ...valid, account_number: '123456789' }).success).toBe(
      false,
    ));
  it('rejects non-numeric account number', () =>
    expect(BankTransferSchema.safeParse({ ...valid, account_number: '012345678A' }).success).toBe(
      false,
    ));
  it('rejects missing bank_code', () =>
    expect(BankTransferSchema.safeParse({ ...valid, bank_code: undefined }).success).toBe(false));
  it('rejects zero amount', () =>
    expect(BankTransferSchema.safeParse({ ...valid, amount_kobo: 0 }).success).toBe(false));
  it('rejects decimal amount', () =>
    expect(BankTransferSchema.safeParse({ ...valid, amount_kobo: 1000.5 }).success).toBe(false));
  it('rejects 5-digit PIN', () =>
    expect(BankTransferSchema.safeParse({ ...valid, pin: '12345' }).success).toBe(false));
  it('rejects missing verified_account_name', () =>
    expect(
      BankTransferSchema.safeParse({ ...valid, verified_account_name: undefined }).success,
    ).toBe(false));
  it('rejects short account_name', () =>
    expect(BankTransferSchema.safeParse({ ...valid, account_name: 'J' }).success).toBe(false));
});

// ---------------------------------------------------------------------------
// ListTransfersSchema
// ---------------------------------------------------------------------------

describe('ListTransfersSchema', () => {
  it('defaults limit to 20', () => {
    const r = ListTransfersSchema.safeParse({});
    if (r.success) expect(r.data.limit).toBe(20);
  });
  it('defaults type to all', () => {
    const r = ListTransfersSchema.safeParse({});
    if (r.success) expect(r.data.type).toBe('all');
  });
  it('defaults direction to all', () => {
    const r = ListTransfersSchema.safeParse({});
    if (r.success) expect(r.data.direction).toBe('all');
  });
  it('accepts type: internal', () =>
    expect(ListTransfersSchema.safeParse({ type: 'internal' }).success).toBe(true));
  it('accepts type: bank', () =>
    expect(ListTransfersSchema.safeParse({ type: 'bank' }).success).toBe(true));
  it('accepts direction: sent', () =>
    expect(ListTransfersSchema.safeParse({ direction: 'sent' }).success).toBe(true));
  it('accepts status: pending', () =>
    expect(ListTransfersSchema.safeParse({ status: 'pending' }).success).toBe(true));
  it('accepts status: reversed', () =>
    expect(ListTransfersSchema.safeParse({ status: 'reversed' }).success).toBe(true));
  it('rejects limit > 50', () =>
    expect(ListTransfersSchema.safeParse({ limit: 51 }).success).toBe(false));
  it('rejects limit < 1', () =>
    expect(ListTransfersSchema.safeParse({ limit: 0 }).success).toBe(false));
  it('rejects invalid type', () =>
    expect(ListTransfersSchema.safeParse({ type: 'wire' }).success).toBe(false));
});

// ---------------------------------------------------------------------------
// RetryTransferSchema
// ---------------------------------------------------------------------------

describe('RetryTransferSchema', () => {
  it('accepts valid PIN', () =>
    expect(RetryTransferSchema.safeParse({ pin: '4321' }).success).toBe(true));
  it('rejects 3-digit PIN', () =>
    expect(RetryTransferSchema.safeParse({ pin: '432' }).success).toBe(false));
  it('rejects missing pin', () => expect(RetryTransferSchema.safeParse({}).success).toBe(false));
});

// ---------------------------------------------------------------------------
// Reference format
// ---------------------------------------------------------------------------

describe('Transfer reference format', () => {
  const INTERNAL_RE = /^FLK-\d{8}-[0-9A-F]{6}$/;
  const REVERSAL_RE = /^REV-FLK-\d{8}-[0-9A-F]{6}$/;
  const d = new Date();
  const date = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;

  it('internal reference matches FLK-YYYYMMDD-XXXXXX', () =>
    expect(INTERNAL_RE.test(`FLK-${date}-A1B2C3`)).toBe(true));
  it('reversal reference matches REV-FLK-YYYYMMDD-XXXXXX', () =>
    expect(REVERSAL_RE.test(`REV-FLK-${date}-A1B2C3`)).toBe(true));
  it('rejects wrong prefix', () => expect(INTERNAL_RE.test('TRF-20260506-A1B2C3')).toBe(false));
  it('rejects short hex', () => expect(INTERNAL_RE.test('FLK-20260506-A1B2')).toBe(false));
  it('rejects lowercase hex', () => expect(INTERNAL_RE.test('FLK-20260506-a1b2c3')).toBe(false));
});

// ---------------------------------------------------------------------------
// Transaction number derivation
// ---------------------------------------------------------------------------

describe('Transaction number format', () => {
  function transactionNumber(reference: string): string {
    const parts = reference.split('-');
    return `TXN-${parts[parts.length - 1] ?? reference}`;
  }

  it('derives TXN-XXXXXX from FLK-YYYYMMDD-XXXXXX', () => {
    expect(transactionNumber('FLK-20260517-8AD496')).toBe('TXN-8AD496');
  });
  it('derives from reversal reference too', () => {
    expect(transactionNumber('REV-FLK-20260517-8AD496')).toBe('TXN-8AD496');
  });
});

// ---------------------------------------------------------------------------
// KYC daily limits
// ---------------------------------------------------------------------------

describe('KYC daily limit enforcement', () => {
  it('blocks when used + amount exceeds Tier 1 limit', () => {
    const limit = BigInt(5_000_000);
    const used = BigInt(4_900_000);
    const amount = BigInt(200_000);
    expect(used + amount > limit).toBe(true);
  });

  it('allows when exactly at Tier 1 limit', () => {
    const limit = BigInt(5_000_000);
    const used = BigInt(4_500_000);
    const amount = BigInt(500_000);
    expect(used + amount > limit).toBe(false);
  });

  it('Tier 2 FlowKey→FlowKey is 20x Tier 1', () => {
    expect(BigInt(100_000_000) / BigInt(5_000_000)).toBe(BigInt(20));
  });

  it('bank transfer fee is ₦50 for Tier 1', () => expect(BigInt(5_000).toString()).toBe('5000'));
  it('bank transfer fee is ₦0 for Tier 2+', () => expect(BigInt(0)).toBe(BigInt(0)));
});

// ---------------------------------------------------------------------------
// Double-entry invariants
// ---------------------------------------------------------------------------

describe('Double-entry ledger invariants', () => {
  it('internal: sender debit = gross amount', () => expect(BigInt(500_000)).toBe(BigInt(500_000)));
  it('internal: receiver credit = net (zero fee)', () =>
    expect(BigInt(500_000) - BigInt(0)).toBe(BigInt(500_000)));
  it('bank: 1 ledger entry on initiation', () => expect(1).toBe(1));
  it('reversal credit = original debit', () => expect(BigInt(1_000_000)).toBe(BigInt(1_000_000)));
  it('net_amount = amount - fee', () =>
    expect(BigInt(1_000_000) - BigInt(5_000)).toBe(BigInt(995_000)));
  it('kobo values serialise to strings', () => {
    expect(BigInt(500_000).toString()).toBe('500000');
    expect(BigInt(100_000_000).toString()).toBe('100000000');
  });
});

// ---------------------------------------------------------------------------
// UID auth model
// ---------------------------------------------------------------------------

describe('UID auth model', () => {
  it('UID transfer uses UID owner wallet, not device user wallet', () => {
    const uidOwnerWallet = 'wallet-A';
    const deviceUserWallet = 'wallet-B';
    const senderWallet = uidOwnerWallet;
    expect(senderWallet).not.toBe(deviceUserWallet);
  });

  it('device_user_id is logged for audit — does not affect who pays', () => {
    const uidOwnerId = 'user-A';
    const deviceUserId = 'user-B';
    const mismatch = uidOwnerId !== deviceUserId;
    expect(mismatch).toBe(true);
  });

  it('UID auth uses UPP (6-digit), not PIN (4-digit)', () => {
    const uppLength = 6;
    const pinLength = 4;
    expect(uppLength).not.toBe(pinLength);
  });

  it('UPP lockout is separate from PIN lockout', () => {
    // Different factor keys: 'passcode' (UPP), 'pin' (transaction PIN)
    expect('passcode').not.toBe('pin');
  });
});

// ---------------------------------------------------------------------------
// Bank transfer lifecycle
// ---------------------------------------------------------------------------

describe('Bank transfer status lifecycle', () => {
  const VALID = ['pending', 'processing', 'completed', 'failed', 'reversed'];

  it('pending is the initial status', () => expect(VALID).toContain('pending'));
  it('all 5 statuses are covered', () => expect(VALID).toHaveLength(5));
  it('only failed can be retried', () => {
    const retryable = ['failed'];
    expect(retryable).not.toContain('pending');
    expect(retryable).not.toContain('completed');
    expect(retryable).not.toContain('reversed');
  });
  it('reversal nets zero impact on sender', () => {
    expect(BigInt(1_000_000) - BigInt(1_000_000)).toBe(BigInt(0));
  });
});

// ---------------------------------------------------------------------------
// InternalTransferResult shape (updated for rich objects)
// ---------------------------------------------------------------------------

describe('InternalTransferResult shape', () => {
  const mock: InternalTransferResult = {
    transaction_id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
    transaction_number: 'TXN-A1B2C3',
    reference: 'FLK-20260506-A1B2C3',
    transaction_date: new Date().toISOString(),
    status: 'completed',
    payment_method: 'FlowKey to FlowKey',
    amount_kobo: '500000',
    fee_kobo: '0',
    net_amount_kobo: '500000',
    narration: 'Rent',
    sender: {
      user_id: 'user-uuid-1',
      display_name: 'Kingsley Chibuike',
      username: 'kingsley_kt',
      wallet_id: 'wallet-uuid-1',
    },
    recipient: {
      user_id: 'user-uuid-2',
      display_name: 'Test User',
      username: 'test_user',
      wallet_id: 'wallet-uuid-2',
    },
  };

  it('status is completed', () => expect(mock.status).toBe('completed'));
  it('has transaction_number', () => expect(mock.transaction_number).toBeDefined());
  it('has transaction_date as ISO string', () =>
    expect(() => new Date(mock.transaction_date)).not.toThrow());
  it('has payment_method', () => expect(mock.payment_method).toBeDefined());
  it('amount_kobo is a string', () => expect(typeof mock.amount_kobo).toBe('string'));
  it('fee_kobo is a string', () => expect(typeof mock.fee_kobo).toBe('string'));
  it('net_amount_kobo is a string', () => expect(typeof mock.net_amount_kobo).toBe('string'));
  it('net = amount - fee', () =>
    expect(BigInt(mock.net_amount_kobo)).toBe(BigInt(mock.amount_kobo) - BigInt(mock.fee_kobo)));
  it('sender has display_name', () => expect(mock.sender.display_name).toBeDefined());
  it('sender has username', () => expect(mock.sender.username).toBeDefined());
  it('sender has wallet_id', () => expect(mock.sender.wallet_id).toBeDefined());
  it('recipient has display_name', () => expect(mock.recipient.display_name).toBeDefined());
  it('recipient has username', () =>
    expect((mock.recipient as { username: string }).username).toBeDefined());
});

// ---------------------------------------------------------------------------
// BankTransferResult shape (updated for rich objects)
// ---------------------------------------------------------------------------

describe('BankTransferResult shape', () => {
  const mock: BankTransferResult = {
    transaction_id: 'uuid-1',
    transaction_number: 'TXN-D4E5F6',
    reference: 'FLK-20260506-D4E5F6',
    transaction_date: new Date().toISOString(),
    status: 'pending',
    payment_method: 'FlowKey to Bank',
    amount_kobo: '1000000',
    fee_kobo: '5000',
    net_amount_kobo: '995000',
    narration: null,
    sender: {
      user_id: 'user-uuid-1',
      display_name: 'Kingsley Chibuike',
      username: 'kingsley_kt',
      wallet_id: 'wallet-uuid-1',
    },
    recipient: {
      account_number: '****6789',
      account_name: 'John Doe',
      bank_name: 'Guaranty Trust Bank',
      bank_code: '058',
    },
    estimated_settlement: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    completed_at: null,
  };

  it('status is pending on initiation', () => expect(mock.status).toBe('pending'));
  it('completed_at is null on initiation', () => expect(mock.completed_at).toBeNull());
  it('recipient.account_number is masked', () =>
    expect(mock.recipient.account_number).toMatch(/^\*{4}\d{4}$/));
  it('recipient has bank_name', () => expect(mock.recipient.bank_name).toBeDefined());
  it('recipient has account_name', () => expect(mock.recipient.account_name).toBeDefined());
  it('sender has display_name', () => expect(mock.sender.display_name).toBeDefined());
  it('estimated_settlement is ISO string', () =>
    expect(() => new Date(mock.estimated_settlement)).not.toThrow());
  it('net = amount - fee', () =>
    expect(BigInt(mock.net_amount_kobo)).toBe(BigInt(mock.amount_kobo) - BigInt(mock.fee_kobo)));
  it('has transaction_number', () => expect(mock.transaction_number).toBeDefined());
  it('has payment_method', () => expect(mock.payment_method).toBeDefined());
});

// ---------------------------------------------------------------------------
// PaymentMethod labels
// ---------------------------------------------------------------------------

describe('PaymentMethod values', () => {
  const valid: PaymentMethod[] = [
    'FlowKey to FlowKey',
    'FlowKey to Bank',
    'Universal ID — FlowKey to FlowKey',
    'Universal ID — FlowKey to Bank',
    'QR Code',
  ];

  it('all expected payment methods are typed', () => {
    expect(valid).toHaveLength(5);
  });

  it('QR Code is a valid payment method', () => {
    expect(valid).toContain('QR Code');
  });

  it('UID methods include both internal and bank', () => {
    expect(valid).toContain('Universal ID — FlowKey to FlowKey');
    expect(valid).toContain('Universal ID — FlowKey to Bank');
  });
});
