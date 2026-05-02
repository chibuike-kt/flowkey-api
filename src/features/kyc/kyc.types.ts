export type KycTier = 1 | 2 | 3;

export interface TierLimits {
  flowkey_to_flowkey_kobo: string;
  flowkey_to_bank_kobo: string;
  airtime_kobo: string;
  other_bills_kobo: string;
}

export const TIER_LIMITS: Record<KycTier, TierLimits> = {
  1: {
    flowkey_to_flowkey_kobo: '5000000', // ₦50,000
    flowkey_to_bank_kobo: '5000000', // ₦50,000
    airtime_kobo: '5000000', // ₦50,000
    other_bills_kobo: '50000000', // ₦500,000
  },
  2: {
    flowkey_to_flowkey_kobo: '100000000', // ₦1,000,000
    flowkey_to_bank_kobo: '100000000', // ₦1,000,000
    airtime_kobo: '20000000', // ₦200,000
    other_bills_kobo: '100000000', // ₦1,000,000
  },
  3: {
    flowkey_to_flowkey_kobo: '500000000', // ₦5,000,000
    flowkey_to_bank_kobo: '500000000', // ₦5,000,000
    airtime_kobo: '20000000', // ₦200,000
    other_bills_kobo: '100000000', // ₦1,000,000
  },
};

export interface KycStatusResult {
  current_tier: KycTier;
  limits: TierLimits;
  last_attempt: KycAttemptSummary | null;
  next_attempt_allowed_at: Date | null;
}

export interface KycAttemptSummary {
  id: string;
  tier_target: KycTier;
  status: 'pending' | 'passed' | 'failed' | 'error';
  failure_reason: string | null;
  is_admin_override: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface UpgradeToTier2Payload {
  bvn: string;
  nin: string;
}

export interface UpgradeToTier3Payload {
  address_line: string;
  utility_bill_reference: string; // reference ID from client-side Prembly upload
}

export type UpgradeKycPayload =
  | ({ target_tier: 2 } & UpgradeToTier2Payload)
  | ({ target_tier: 3 } & UpgradeToTier3Payload);

export interface PremblyResult {
  success: boolean; // provider call succeeded (network + response)
  verified: boolean; // identity check passed
  reference_id: string | null;
  error?: string;
}
