/**
 * Phase 6 — KYC tests
 */

import { TIER_LIMITS } from '../../../src/features/kyc/kyc.types';
import { UpgradeKycSchema } from '../../../src/features/kyc/kyc.schema';

describe('TIER_LIMITS', () => {
  it('defines limits for tiers 1, 2, 3 only', () => {
    expect(Object.keys(TIER_LIMITS)).toEqual(['1', '2', '3']);
  });

  it('Tier 1 — correct kobo values', () => {
    expect(TIER_LIMITS[1].flowkey_to_flowkey_kobo).toBe('5000000');
    expect(TIER_LIMITS[1].flowkey_to_bank_kobo).toBe('5000000');
    expect(TIER_LIMITS[1].airtime_kobo).toBe('5000000');
    expect(TIER_LIMITS[1].other_bills_kobo).toBe('50000000');
  });

  it('Tier 2 — correct kobo values', () => {
    expect(TIER_LIMITS[2].flowkey_to_flowkey_kobo).toBe('100000000');
    expect(TIER_LIMITS[2].flowkey_to_bank_kobo).toBe('100000000');
    expect(TIER_LIMITS[2].airtime_kobo).toBe('20000000');
    expect(TIER_LIMITS[2].other_bills_kobo).toBe('100000000');
  });

  it('Tier 3 — correct kobo values', () => {
    expect(TIER_LIMITS[3].flowkey_to_flowkey_kobo).toBe('500000000');
    expect(TIER_LIMITS[3].flowkey_to_bank_kobo).toBe('500000000');
    expect(TIER_LIMITS[3].airtime_kobo).toBe('20000000');
    expect(TIER_LIMITS[3].other_bills_kobo).toBe('100000000');
  });

  it('airtime limit does not increase from Tier 2 to Tier 3', () => {
    expect(TIER_LIMITS[2].airtime_kobo).toBe(TIER_LIMITS[3].airtime_kobo);
  });

  it('other_bills limit does not increase from Tier 2 to Tier 3', () => {
    expect(TIER_LIMITS[2].other_bills_kobo).toBe(TIER_LIMITS[3].other_bills_kobo);
  });

  it('flowkey_to_flowkey limit increases with each tier', () => {
    expect(BigInt(TIER_LIMITS[2].flowkey_to_flowkey_kobo)).toBeGreaterThan(
      BigInt(TIER_LIMITS[1].flowkey_to_flowkey_kobo),
    );
    expect(BigInt(TIER_LIMITS[3].flowkey_to_flowkey_kobo)).toBeGreaterThan(
      BigInt(TIER_LIMITS[2].flowkey_to_flowkey_kobo),
    );
  });

  it('all limit values are positive string-encoded integers', () => {
    for (const tier of [1, 2, 3] as const) {
      for (const val of Object.values(TIER_LIMITS[tier])) {
        expect(typeof val).toBe('string');
        expect(Number.isInteger(Number(val))).toBe(true);
        expect(Number(val)).toBeGreaterThan(0);
      }
    }
  });
});

describe('UpgradeKycSchema — Tier 2', () => {
  const base = { target_tier: 2, bvn: '12345678901', nin: '98765432100' };

  it('accepts valid BVN + NIN', () => {
    expect(UpgradeKycSchema.safeParse(base).success).toBe(true);
  });

  it('rejects BVN shorter than 11 digits', () => {
    expect(UpgradeKycSchema.safeParse({ ...base, bvn: '1234567890' }).success).toBe(false);
  });

  it('rejects BVN longer than 11 digits', () => {
    expect(UpgradeKycSchema.safeParse({ ...base, bvn: '123456789012' }).success).toBe(false);
  });

  it('rejects non-numeric BVN', () => {
    expect(UpgradeKycSchema.safeParse({ ...base, bvn: 'ABCDE678901' }).success).toBe(false);
  });

  it('rejects NIN shorter than 11 digits', () => {
    expect(UpgradeKycSchema.safeParse({ ...base, nin: '9876543210' }).success).toBe(false);
  });

  it('rejects missing NIN', () => {
    const { nin: _, ...rest } = base;
    expect(UpgradeKycSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects missing BVN', () => {
    const { bvn: _, ...rest } = base;
    expect(UpgradeKycSchema.safeParse(rest).success).toBe(false);
  });
});

describe('UpgradeKycSchema — Tier 3', () => {
  const base = {
    target_tier: 3,
    address_line: '12 Admiralty Way, Lekki Phase 1, Lagos',
    utility_bill_reference: 'prembly-ref-abc123',
  };

  it('accepts valid address + utility bill reference', () => {
    expect(UpgradeKycSchema.safeParse(base).success).toBe(true);
  });

  it('rejects address shorter than 5 characters', () => {
    expect(UpgradeKycSchema.safeParse({ ...base, address_line: 'No' }).success).toBe(false);
  });

  it('rejects missing utility_bill_reference', () => {
    const { utility_bill_reference: _, ...rest } = base;
    expect(UpgradeKycSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects empty utility_bill_reference', () => {
    expect(UpgradeKycSchema.safeParse({ ...base, utility_bill_reference: '' }).success).toBe(false);
  });
});

describe('UpgradeKycSchema — discriminated union', () => {
  it('rejects target_tier: 1', () => {
    expect(
      UpgradeKycSchema.safeParse({ target_tier: 1, bvn: '12345678901', nin: '98765432100' })
        .success,
    ).toBe(false);
  });

  it('rejects missing target_tier', () => {
    expect(UpgradeKycSchema.safeParse({ bvn: '12345678901', nin: '98765432100' }).success).toBe(
      false,
    );
  });

  it('rejects target_tier: 4', () => {
    expect(
      UpgradeKycSchema.safeParse({ target_tier: 4, bvn: '12345678901', nin: '98765432100' })
        .success,
    ).toBe(false);
  });

  it('rejects Tier 3 fields submitted for target_tier: 2', () => {
    expect(
      UpgradeKycSchema.safeParse({
        target_tier: 2,
        address_line: '12 Admiralty Way',
        utility_bill_reference: 'ref',
      }).success,
    ).toBe(false);
  });
});

describe('Prembly provider stubs', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let provider: any;

  beforeAll(() => {
    jest.resetModules();
    process.env['NODE_ENV'] = 'test';
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const cfg = require('../../../src/config') as typeof import('../../../src/config');
    cfg._resetConfigForTesting();
    void cfg.initConfig();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    provider = require('../../../src/features/kyc/prembly.provider');
  });

  it('verifyBvn returns success:true, verified:true in non-production', async () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const result = (await provider.verifyBvn('12345678901')) as {
      success: boolean;
      verified: boolean;
      reference_id: string;
    };
    expect(result.success).toBe(true);
    expect(result.verified).toBe(true);
    expect(result.reference_id).toMatch(/^stub-bvn-/);
  });

  it('verifyNin returns success:true, verified:true in non-production', async () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const result = (await provider.verifyNin('98765432100')) as {
      success: boolean;
      verified: boolean;
      reference_id: string;
    };
    expect(result.success).toBe(true);
    expect(result.verified).toBe(true);
    expect(result.reference_id).toMatch(/^stub-nin-/);
  });

  it('verifyAddress returns success:true, verified:true in non-production', async () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const result = (await provider.verifyAddress('12 Admiralty Way', 'PREMBLY-REF-001')) as {
      success: boolean;
      verified: boolean;
      reference_id: string;
    };
    expect(result.success).toBe(true);
    expect(result.verified).toBe(true);
    expect(result.reference_id).toMatch(/^stub-addr-/);
  });

  it('verifyBvn stub generates unique reference IDs', async () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const [r1, r2] = (await Promise.all([
      provider.verifyBvn('12345678901'),
      provider.verifyBvn('12345678902'),
    ])) as Array<{ reference_id: string }>;
    expect(r1.reference_id).not.toBe(r2.reference_id);
  });
});
