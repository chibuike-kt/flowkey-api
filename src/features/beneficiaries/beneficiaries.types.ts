export type BeneficiaryType = 'internal' | 'bank';

export interface Beneficiary {
  id: string;
  user_id: string;
  type: BeneficiaryType;
  nickname: string | null;
  // Internal beneficiary fields
  recipient_user_id: string | null;
  recipient_name: string | null;
  // Bank beneficiary fields
  bank_code: string | null;
  bank_name: string | null;
  account_number: string | null; // masked in list: ****6789, full in detail
  account_name: string | null;
  account_verified: boolean;
  account_verified_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface BeneficiaryListItem {
  id: string;
  type: BeneficiaryType;
  nickname: string | null;
  display_name: string; // computed: nickname ?? account_name ?? username
  display_sub: string; // computed: bank_name + masked acct, or username
  recipient_user_id: string | null;
  bank_code: string | null;
  bank_name: string | null;
  account_number: string | null; // masked: ****6789
  account_name: string | null;
  account_verified: boolean;
  created_at: Date;
}
