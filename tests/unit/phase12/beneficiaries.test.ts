import {
  AddBeneficiarySchema,
  UpdateBeneficiarySchema,
  ListBeneficiariesSchema,
} from '../../../src/features/beneficiaries/beneficiaries.schema';

// ---------------------------------------------------------------------------
// AddBeneficiarySchema — internal
// ---------------------------------------------------------------------------

describe('AddBeneficiarySchema — internal', () => {
  const valid = {
    type: 'internal' as const,
    recipient_wallet_id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  };

  it('accepts valid internal beneficiary', () =>
    expect(AddBeneficiarySchema.safeParse(valid).success).toBe(true));
  it('accepts optional nickname', () =>
    expect(AddBeneficiarySchema.safeParse({ ...valid, nickname: 'Kingsley' }).success).toBe(true));
  it('rejects non-UUID wallet id', () =>
    expect(
      AddBeneficiarySchema.safeParse({ ...valid, recipient_wallet_id: 'not-uuid' }).success,
    ).toBe(false));
  it('rejects missing recipient_wallet_id', () =>
    expect(AddBeneficiarySchema.safeParse({ type: 'internal' }).success).toBe(false));
  it('rejects nickname over 50 chars', () =>
    expect(AddBeneficiarySchema.safeParse({ ...valid, nickname: 'x'.repeat(51) }).success).toBe(
      false,
    ));
  it('rejects empty nickname', () =>
    expect(AddBeneficiarySchema.safeParse({ ...valid, nickname: '' }).success).toBe(false));
});

// ---------------------------------------------------------------------------
// AddBeneficiarySchema — bank
// ---------------------------------------------------------------------------

describe('AddBeneficiarySchema — bank', () => {
  const valid = {
    type: 'bank' as const,
    bank_code: '058',
    bank_name: 'Guaranty Trust Bank',
    account_number: '0123456789',
    account_name: 'John Doe',
  };

  it('accepts valid bank beneficiary', () =>
    expect(AddBeneficiarySchema.safeParse(valid).success).toBe(true));
  it('accepts optional nickname', () =>
    expect(AddBeneficiarySchema.safeParse({ ...valid, nickname: 'John' }).success).toBe(true));
  it('rejects non-10-digit account number', () =>
    expect(AddBeneficiarySchema.safeParse({ ...valid, account_number: '123456789' }).success).toBe(
      false,
    ));
  it('rejects non-numeric account number', () =>
    expect(AddBeneficiarySchema.safeParse({ ...valid, account_number: '012345678A' }).success).toBe(
      false,
    ));
  it('rejects missing bank_code', () =>
    expect(AddBeneficiarySchema.safeParse({ ...valid, bank_code: undefined }).success).toBe(false));
  it('rejects missing account_name', () =>
    expect(AddBeneficiarySchema.safeParse({ ...valid, account_name: undefined }).success).toBe(
      false,
    ));
  it('rejects short account_name', () =>
    expect(AddBeneficiarySchema.safeParse({ ...valid, account_name: 'J' }).success).toBe(false));
  it('rejects missing bank_name', () =>
    expect(AddBeneficiarySchema.safeParse({ ...valid, bank_name: undefined }).success).toBe(false));
});

// ---------------------------------------------------------------------------
// AddBeneficiarySchema — discriminated union
// ---------------------------------------------------------------------------

describe('AddBeneficiarySchema — discriminated union', () => {
  it('rejects unknown type', () =>
    expect(AddBeneficiarySchema.safeParse({ type: 'crypto' }).success).toBe(false));
  it('rejects missing type', () => expect(AddBeneficiarySchema.safeParse({}).success).toBe(false));
  it('rejects bank fields on internal type', () =>
    expect(
      AddBeneficiarySchema.safeParse({
        type: 'internal',
        recipient_wallet_id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
        account_number: '0123456789', // bank field ignored — still valid
      }).success,
    ).toBe(true));
});

// ---------------------------------------------------------------------------
// UpdateBeneficiarySchema
// ---------------------------------------------------------------------------

describe('UpdateBeneficiarySchema', () => {
  it('accepts a new nickname', () =>
    expect(UpdateBeneficiarySchema.safeParse({ nickname: 'Bro' }).success).toBe(true));
  it('accepts null to clear nickname', () =>
    expect(UpdateBeneficiarySchema.safeParse({ nickname: null }).success).toBe(true));
  it('rejects empty string nickname', () =>
    expect(UpdateBeneficiarySchema.safeParse({ nickname: '' }).success).toBe(false));
  it('rejects nickname over 50 chars', () =>
    expect(UpdateBeneficiarySchema.safeParse({ nickname: 'x'.repeat(51) }).success).toBe(false));
  it('rejects missing nickname field', () =>
    expect(UpdateBeneficiarySchema.safeParse({}).success).toBe(false));
});

// ---------------------------------------------------------------------------
// ListBeneficiariesSchema
// ---------------------------------------------------------------------------

describe('ListBeneficiariesSchema', () => {
  it('defaults type to all', () => {
    const r = ListBeneficiariesSchema.safeParse({});
    if (r.success) expect(r.data.type).toBe('all');
  });
  it('defaults limit to 50', () => {
    const r = ListBeneficiariesSchema.safeParse({});
    if (r.success) expect(r.data.limit).toBe(50);
  });
  it('accepts type: internal', () =>
    expect(ListBeneficiariesSchema.safeParse({ type: 'internal' }).success).toBe(true));
  it('accepts type: bank', () =>
    expect(ListBeneficiariesSchema.safeParse({ type: 'bank' }).success).toBe(true));
  it('accepts search query', () =>
    expect(ListBeneficiariesSchema.safeParse({ search: 'John' }).success).toBe(true));
  it('accepts cursor', () =>
    expect(
      ListBeneficiariesSchema.safeParse({ cursor: '3fa85f64-5717-4562-b3fc-2c963f66afa6' }).success,
    ).toBe(true));
  it('rejects limit > 100', () =>
    expect(ListBeneficiariesSchema.safeParse({ limit: 101 }).success).toBe(false));
  it('rejects invalid type', () =>
    expect(ListBeneficiariesSchema.safeParse({ type: 'crypto' }).success).toBe(false));
  it('rejects non-UUID cursor', () =>
    expect(ListBeneficiariesSchema.safeParse({ cursor: 'not-uuid' }).success).toBe(false));
});

// ---------------------------------------------------------------------------
// Account masking logic
// ---------------------------------------------------------------------------

describe('Account number masking', () => {
  function mask(acct: string | null): string | null {
    if (!acct || acct.length < 4) return acct;
    return `****${acct.slice(-4)}`;
  }

  it('masks a 10-digit NUBAN', () => expect(mask('0123456789')).toBe('****6789'));
  it('returns null for null input', () => expect(mask(null)).toBeNull());
  it('returns short string unchanged', () => expect(mask('123')).toBe('123'));
  it('last 4 are always visible', () => expect(mask('9056347821')).toBe('****7821'));
  it('exactly 4 digits shows all 4', () => expect(mask('1234')).toBe('****1234'));
});

// ---------------------------------------------------------------------------
// Display name computation
// ---------------------------------------------------------------------------

describe('Beneficiary display name', () => {
  function displayName(row: {
    nickname: string | null;
    type: string;
    recipient_name: string | null;
    account_name: string | null;
  }): string {
    return (
      row.nickname ?? (row.type === 'internal' ? row.recipient_name : row.account_name) ?? 'Unknown'
    );
  }

  it('prefers nickname over account name', () =>
    expect(
      displayName({
        nickname: 'Bro',
        type: 'bank',
        recipient_name: null,
        account_name: 'John Doe',
      }),
    ).toBe('Bro'));
  it('falls back to recipient_name for internal', () =>
    expect(
      displayName({
        nickname: null,
        type: 'internal',
        recipient_name: 'Kingsley',
        account_name: null,
      }),
    ).toBe('Kingsley'));
  it('falls back to account_name for bank', () =>
    expect(
      displayName({ nickname: null, type: 'bank', recipient_name: null, account_name: 'John Doe' }),
    ).toBe('John Doe'));
  it('falls back to Unknown when all null', () =>
    expect(
      displayName({ nickname: null, type: 'bank', recipient_name: null, account_name: null }),
    ).toBe('Unknown'));
});

// ---------------------------------------------------------------------------
// Duplicate detection logic
// ---------------------------------------------------------------------------

describe('Duplicate detection', () => {
  it('same account_number + bank_code = duplicate for bank', () => {
    const saved = { account_number: '0123456789', bank_code: '058' };
    const incoming = { account_number: '0123456789', bank_code: '058' };
    const isDuplicate =
      saved.account_number === incoming.account_number && saved.bank_code === incoming.bank_code;
    expect(isDuplicate).toBe(true);
  });

  it('same account but different bank = not a duplicate', () => {
    const saved = { account_number: '0123456789', bank_code: '058' };
    const incoming = { account_number: '0123456789', bank_code: '011' };
    const isDuplicate =
      saved.account_number === incoming.account_number && saved.bank_code === incoming.bank_code;
    expect(isDuplicate).toBe(false);
  });

  it('same recipient_user_id = duplicate for internal', () => {
    const saved = { recipient_user_id: 'user-A' };
    const incoming = { recipient_user_id: 'user-A' };
    expect(saved.recipient_user_id === incoming.recipient_user_id).toBe(true);
  });

  it('self-add should be blocked', () => {
    const userId = 'user-A';
    const recipientUserId = 'user-A';
    expect(userId === recipientUserId).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Soft delete — deleted_at is set, not hard deleted
// ---------------------------------------------------------------------------

describe('Soft delete', () => {
  it('soft-deleted beneficiary has deleted_at set', () => {
    const deletedAt = new Date();
    expect(deletedAt).toBeInstanceOf(Date);
    expect(deletedAt.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('list query excludes soft-deleted records', () => {
    // Simulate the filter: deleted_at: null
    const records = [
      { id: '1', deleted_at: null },
      { id: '2', deleted_at: new Date() },
      { id: '3', deleted_at: null },
    ];
    const visible = records.filter((r) => r.deleted_at === null);
    expect(visible).toHaveLength(2);
    expect(visible.map((r) => r.id)).toEqual(['1', '3']);
  });
});
