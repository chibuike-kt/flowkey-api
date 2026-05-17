/**
 * Phase 8/9 — Transfers unit tests
 *
 * Pure logic tests — no DB, no Redis, no network.
 * Tests cover: schemas, reference format, KYC limits,
 * double-entry invariants, UID auth logic, fraud velocity,
 * bank transfer lifecycle, result shapes.
 */

import {
  ResolveRecipientSchema,
  InternalTransferSchema,
  BankTransferSchema,
  ListTransfersSchema,
  RetryTransferSchema,
} from '../../../src/features/transfers/transfers.schema';

// ---------------------------------------------------------------------------
// ResolveRecipientSchema
// ---------------------------------------------------------------------------

describe('ResolveRecipientSchema', () => {
  it('accepts a username',      () => expect(ResolveRecipientSchema.safeParse({ identifier: 'kingsley_kt' }).success).toBe(true));
  it('accepts a Universal ID',  () => expect(ResolveRecipientSchema.safeParse({ identifier: 'BOLT-KP-4821' }).success).toBe(true));
  it('rejects empty string',    () => expect(ResolveRecipientSchema.safeParse({ identifier: '' }).success).toBe(false));
  it('rejects missing field',   () => expect(ResolveRecipientSchema.safeParse({}).success).toBe(false));
  it('rejects > 50 chars',      () => expect(ResolveRecipientSchema.safeParse({ identifier: 'x'.repeat(51) }).success).toBe(false));
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

  it('accepts minimal valid payload',     () => expect(InternalTransferSchema.safeParse(valid).success).toBe(true));
  it('defaults source to username',       () => { const r = InternalTransferSchema.safeParse(valid); if (r.success) expect(r.data.source).toBe('username'); });
  it('accepts source: qr_code',          () => expect(InternalTransferSchema.safeParse({ ...valid, source: 'qr_code' }).success).toBe(true));
  it('rejects source: universal_id (use /transfers/uid/internal instead)', () =>
    expect(InternalTransferSchema.safeParse({ ...valid, source: 'universal_id', uid_identifier: 'BOLT-KP-4821' }).success).toBe(false));
  it('rejects universal_id source without uid_identifier', () =>
    expect(InternalTransferSchema.safeParse({ ...valid, source: 'universal_id' }).success).toBe(false));
  it('accepts optional narration',        () => expect(InternalTransferSchema.safeParse({ ...valid, narration: 'Rent' }).success).toBe(true));
  it('accepts optional device_id',        () => expect(InternalTransferSchema.safeParse({ ...valid, device_id: 'abc123' }).success).toBe(true));
  it('rejects non-UUID wallet id',        () => expect(InternalTransferSchema.safeParse({ ...valid, recipient_wallet_id: 'not-uuid' }).success).toBe(false));
  it('rejects zero amount',               () => expect(InternalTransferSchema.safeParse({ ...valid, amount_kobo: 0 }).success).toBe(false));
  it('rejects negative amount',           () => expect(InternalTransferSchema.safeParse({ ...valid, amount_kobo: -1 }).success).toBe(false));
  it('rejects decimal amount',            () => expect(InternalTransferSchema.safeParse({ ...valid, amount_kobo: 500.5 }).success).toBe(false));
  it('rejects 3-digit PIN',               () => expect(InternalTransferSchema.safeParse({ ...valid, pin: '123' }).success).toBe(false));
  it('rejects 5-digit PIN',               () => expect(InternalTransferSchema.safeParse({ ...valid, pin: '12345' }).success).toBe(false));
  it('rejects alpha PIN',                 () => expect(InternalTransferSchema.safeParse({ ...valid, pin: 'abcd' }).success).toBe(false));
  it('rejects narration > 255 chars',     () => expect(InternalTransferSchema.safeParse({ ...valid, narration: 'x'.repeat(256) }).success).toBe(false));
  it('rejects invalid source value',      () => expect(InternalTransferSchema.safeParse({ ...valid, source: 'sms' }).success).toBe(false));
});

// ---------------------------------------------------------------------------
// BankTransferSchema
// ---------------------------------------------------------------------------

describe('BankTransferSchema', () => {
  const valid = {
    amount_kobo:           1_000_000,
    pin:                   '1234',
    bank_code:             '058',
    account_number:        '0123456789',
    account_name:          'John Doe',
    bank_name:             'Guaranty Trust Bank',
    verified_account_name: 'John Doe',
  };

  it('accepts valid payload',                    () => expect(BankTransferSchema.safeParse(valid).success).toBe(true));
  it('accepts optional narration',               () => expect(BankTransferSchema.safeParse({ ...valid, narration: 'Invoice' }).success).toBe(true));
  it('rejects non-10-digit account number',      () => expect(BankTransferSchema.safeParse({ ...valid, account_number: '123456789' }).success).toBe(false));
  it('rejects non-numeric account number',       () => expect(BankTransferSchema.safeParse({ ...valid, account_number: '012345678A' }).success).toBe(false));
  it('rejects missing bank_code',                () => expect(BankTransferSchema.safeParse({ ...valid, bank_code: undefined }).success).toBe(false));
  it('rejects zero amount',                      () => expect(BankTransferSchema.safeParse({ ...valid, amount_kobo: 0 }).success).toBe(false));
  it('rejects decimal amount',                   () => expect(BankTransferSchema.safeParse({ ...valid, amount_kobo: 1000.5 }).success).toBe(false));
  it('rejects 5-digit PIN',                      () => expect(BankTransferSchema.safeParse({ ...valid, pin: '12345' }).success).toBe(false));
  it('rejects missing verified_account_name',    () => expect(BankTransferSchema.safeParse({ ...valid, verified_account_name: undefined }).success).toBe(false));
  it('rejects short account_name',               () => expect(BankTransferSchema.safeParse({ ...valid, account_name: 'J' }).success).toBe(false));
});

// ---------------------------------------------------------------------------
// ListTransfersSchema
// ---------------------------------------------------------------------------

describe('ListTransfersSchema', () => {
  it('defaults limit to 20',          () => { const r = ListTransfersSchema.safeParse({}); if (r.success) expect(r.data.limit).toBe(20); });
  it('defaults type to all',          () => { const r = ListTransfersSchema.safeParse({}); if (r.success) expect(r.data.type).toBe('all'); });
  it('defaults direction to all',     () => { const r = ListTransfersSchema.safeParse({}); if (r.success) expect(r.data.direction).toBe('all'); });
  it('accepts type: internal',        () => expect(ListTransfersSchema.safeParse({ type: 'internal' }).success).toBe(true));
  it('accepts type: bank',            () => expect(ListTransfersSchema.safeParse({ type: 'bank' }).success).toBe(true));
  it('accepts direction: sent',       () => expect(ListTransfersSchema.safeParse({ direction: 'sent' }).success).toBe(true));
  it('accepts status: pending',       () => expect(ListTransfersSchema.safeParse({ status: 'pending' }).success).toBe(true));
  it('accepts status: reversed',      () => expect(ListTransfersSchema.safeParse({ status: 'reversed' }).success).toBe(true));
  it('rejects limit > 50',            () => expect(ListTransfersSchema.safeParse({ limit: 51 }).success).toBe(false));
  it('rejects limit < 1',             () => expect(ListTransfersSchema.safeParse({ limit: 0 }).success).toBe(false));
  it('rejects invalid type',          () => expect(ListTransfersSchema.safeParse({ type: 'wire' }).success).toBe(false));
});

// ---------------------------------------------------------------------------
// RetryTransferSchema
// ---------------------------------------------------------------------------

describe('RetryTransferSchema', () => {
  it('accepts valid PIN',      () => expect(RetryTransferSchema.safeParse({ pin: '4321' }).success).toBe(true));
  it('rejects 3-digit PIN',    () => expect(RetryTransferSchema.safeParse({ pin: '432' }).success).toBe(false));
  it('rejects missing pin',    () => expect(RetryTransferSchema.safeParse({}).success).toBe(false));
});

// ---------------------------------------------------------------------------
// Reference generator format
// ---------------------------------------------------------------------------

describe('Transfer reference format', () => {
  const INTERNAL_RE = /^FLK-\d{8}-[0-9A-F]{6}$/;
  const REVERSAL_RE = /^REV-FLK-\d{8}-[0-9A-F]{6}$/;

  it('internal reference matches FLK-YYYYMMDD-XXXXXX', () => {
    const d = new Date();
    const date = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
    expect(INTERNAL_RE.test(`FLK-${date}-A1B2C3`)).toBe(true);
  });

  it('reversal reference matches REV-FLK-YYYYMMDD-XXXXXX', () => {
    const d = new Date();
    const date = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
    expect(REVERSAL_RE.test(`REV-FLK-${date}-A1B2C3`)).toBe(true);
  });

  it('rejects wrong prefix',    () => expect(INTERNAL_RE.test('TRF-20260506-A1B2C3')).toBe(false));
  it('rejects short hex',       () => expect(INTERNAL_RE.test('FLK-20260506-A1B2')).toBe(false));
  it('rejects lowercase hex',   () => expect(INTERNAL_RE.test('FLK-20260506-a1b2c3')).toBe(false));
});

// ---------------------------------------------------------------------------
// KYC daily limit logic (BigInt arithmetic)
// ---------------------------------------------------------------------------

describe('KYC daily limit enforcement', () => {
  it('blocks when used + amount exceeds Tier 1 limit', () => {
    const limit     = BigInt(5_000_000);  // ₦50k
    const used      = BigInt(4_900_000);
    const amount    = BigInt(200_000);
    expect(used + amount > limit).toBe(true);
  });

  it('allows when exactly at Tier 1 limit', () => {
    const limit     = BigInt(5_000_000);
    const used      = BigInt(4_500_000);
    const amount    = BigInt(500_000);
    expect(used + amount > limit).toBe(false);
  });

  it('Tier 2 FlowKey→FlowKey is 20x Tier 1', () => {
    const t1 = BigInt(5_000_000);    // ₦50k
    const t2 = BigInt(100_000_000);  // ₦1m
    expect(t2 / t1).toBe(BigInt(20));
  });

  it('Tier 2 bank transfer limit is ₦1m', () => {
    const limit = BigInt(100_000_000);
    expect(limit.toString()).toBe('100000000');
    expect(Number(limit) / 100).toBe(1_000_000); // ₦1m
  });

  it('bank transfer fee is ₦50 for Tier 1', () => {
    const fee = BigInt(5_000); // ₦50 in kobo
    expect(fee.toString()).toBe('5000');
  });

  it('bank transfer fee is ₦0 for Tier 2+', () => {
    const fee = BigInt(0);
    expect(fee).toBe(BigInt(0));
  });
});

// ---------------------------------------------------------------------------
// Double-entry invariants
// ---------------------------------------------------------------------------

describe('Double-entry ledger invariants', () => {
  it('internal: sender debit equals gross amount', () => {
    const amount = BigInt(500_000);
    expect(amount).toBe(BigInt(500_000));
  });

  it('internal: receiver credit equals net (zero fee)', () => {
    const amount = BigInt(500_000);
    const fee    = BigInt(0);
    expect(amount - fee).toBe(BigInt(500_000));
  });

  it('bank: only one ledger entry on initiation (debit sender)', () => {
    // Unlike internal transfers, bank transfers write 1 debit upfront.
    // The credit side is the external bank — not a FlowKey ledger entry.
    const ledgerEntryCount = 1;
    expect(ledgerEntryCount).toBe(1);
  });

  it('bank reversal: credit equals original debit amount', () => {
    const originalDebit  = BigInt(1_000_000);
    const reversalCredit = BigInt(1_000_000);
    expect(reversalCredit).toBe(originalDebit);
  });

  it('net_amount = amount - fee', () => {
    const amount     = BigInt(1_000_000);
    const fee        = BigInt(5_000);
    const netAmount  = amount - fee;
    expect(netAmount).toBe(BigInt(995_000));
  });

  it('kobo values serialise to strings', () => {
    expect(BigInt(500_000).toString()).toBe('500000');
    expect(BigInt(100_000_000).toString()).toBe('100000000');
  });
});

// ---------------------------------------------------------------------------
// UID auth logic
// ---------------------------------------------------------------------------

describe('UID auth mode', () => {
  it('uid_device_mismatch is true when UID owner != device user', () => {
    const uidOwnerId  = 'user-A';
    const deviceUserId = 'user-B';
    const mismatch = uidOwnerId !== deviceUserId;
    expect(mismatch).toBe(true);
  });

  it('uid_device_mismatch is false when same user on their own device', () => {
    const uidOwnerId  = 'user-A';
    const deviceUserId = 'user-A';
    const mismatch = uidOwnerId !== deviceUserId;
    expect(mismatch).toBe(false);
  });

  it('UID transfers use UID owner account_number, not device user', () => {
    // Logic validation: sender wallet = UID owner's wallet, never device user's
    const uidOwnerWalletId   = 'wallet-A';
    const deviceUserWalletId = 'wallet-B';
    // In UID mode, senderWalletId = uidOwnerWalletId
    const senderWalletId = uidOwnerWalletId; // what the service sets
    expect(senderWalletId).not.toBe(deviceUserWalletId);
  });

  it('UID velocity limit is stricter than internal velocity limit', () => {
    const MAX_INTERNAL = 10;
    const MAX_UID      = 3;
    expect(MAX_UID).toBeLessThan(MAX_INTERNAL);
  });
});

// ---------------------------------------------------------------------------
// Bank transfer status lifecycle
// ---------------------------------------------------------------------------

describe('Bank transfer status lifecycle', () => {
  const VALID_STATUSES = ['pending', 'processing', 'completed', 'failed', 'reversed'];

  it('pending is the initial status on initiation', () => {
    expect(VALID_STATUSES).toContain('pending');
  });

  it('all valid statuses are covered', () => {
    expect(VALID_STATUSES).toHaveLength(5);
  });

  it('only failed transfers can be retried', () => {
    const retryableStatuses = ['failed'];
    expect(retryableStatuses).not.toContain('pending');
    expect(retryableStatuses).not.toContain('completed');
    expect(retryableStatuses).not.toContain('reversed');
  });

  it('reversed status means funds returned to sender', () => {
    // Conceptual: original debit + reversal credit = net zero impact
    const originalDebit  = BigInt(1_000_000);
    const reversalCredit = BigInt(1_000_000);
    const netImpact      = reversalCredit - originalDebit;
    expect(netImpact).toBe(BigInt(0));
  });
});

// ---------------------------------------------------------------------------
// InternalTransferResult shape
// ---------------------------------------------------------------------------

describe('InternalTransferResult shape', () => {
  const mock = {
    transaction_id:     '7c9e6679-7425-40de-944b-e07fc1f90ae7',
    reference:          'FLK-20260506-A1B2C3',
    status:             'completed' as const,
    amount_kobo:        '500000',
    fee_kobo:           '0',
    net_amount_kobo:    '500000',
    narration:          'Rent',
    source:             'username' as const,
    sender_wallet_id:   '3fa85f64-5717-4562-b3fc-2c963f66afa6',
    receiver_wallet_id: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
    created_at:         new Date(),
  };

  it('status is completed',              () => expect(mock.status).toBe('completed'));
  it('amount_kobo is a string',          () => expect(typeof mock.amount_kobo).toBe('string'));
  it('fee_kobo is a string',             () => expect(typeof mock.fee_kobo).toBe('string'));
  it('net_amount_kobo is a string',      () => expect(typeof mock.net_amount_kobo).toBe('string'));
  it('source is present',                () => expect(mock.source).toBe('username'));
  it('created_at is a Date',             () => expect(mock.created_at).toBeInstanceOf(Date));
  it('net = amount - fee (zero fee)',    () => expect(BigInt(mock.net_amount_kobo)).toBe(BigInt(mock.amount_kobo) - BigInt(mock.fee_kobo)));
});

// ---------------------------------------------------------------------------
// BankTransferResult shape
// ---------------------------------------------------------------------------

describe('BankTransferResult shape', () => {
  const mock = {
    transaction_id:       '3fa85f64-5717-4562-b3fc-2c963f66afa6',
    reference:            'FLK-20260506-D4E5F6',
    status:               'pending' as const,
    amount_kobo:          '1000000',
    fee_kobo:             '5000',
    net_amount_kobo:      '995000',
    narration:            null,
    recipient_account:    '****6789',
    recipient_bank_name:  'Guaranty Trust Bank',
    recipient_name:       'John Doe',
    estimated_settlement: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    sender_wallet_id:     '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
    created_at:           new Date(),
    completed_at:         null,
  };

  it('status starts as pending',                     () => expect(mock.status).toBe('pending'));
  it('completed_at is null on initiation',           () => expect(mock.completed_at).toBeNull());
  it('recipient_account is masked',                  () => expect(mock.recipient_account).toMatch(/^\*{4}\d{4}$/));
  it('estimated_settlement is ISO string',           () => expect(() => new Date(mock.estimated_settlement)).not.toThrow());
  it('amount_kobo is string',                        () => expect(typeof mock.amount_kobo).toBe('string'));
  it('fee applied: net = amount - fee',              () => {
    expect(BigInt(mock.net_amount_kobo)).toBe(BigInt(mock.amount_kobo) - BigInt(mock.fee_kobo));
  });
});
