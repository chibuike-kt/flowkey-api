// ---------------------------------------------------------------------------
// Virtual account
// ---------------------------------------------------------------------------

export interface VirtualAccount {
  id: string;
  wallet_id: string;
  account_number: string;
  account_name: string;
  bank_name: string;
  bank_code: string;
  provider: 'providus';
  is_active: boolean;
  created_at: Date;
}

// ---------------------------------------------------------------------------
// Saved card (token only — no raw PAN ever stored here)
// ---------------------------------------------------------------------------

export interface SavedCard {
  id: string;
  user_id: string;
  last4: string;
  card_type: string; // 'visa' | 'mastercard' | 'verve' | etc.
  bank: string;
  expiry_month: string; // '01'–'12'
  expiry_year: string; // '2028'
  is_default: boolean;
  created_at: Date;
}

// ---------------------------------------------------------------------------
// Deposit record
// ---------------------------------------------------------------------------

export type DepositChannel = 'virtual_account' | 'card';
export type DepositStatus = 'pending' | 'completed' | 'failed';

export interface DepositRecord {
  id: string;
  wallet_id: string;
  channel: DepositChannel;
  status: DepositStatus;
  amount_kobo: string;
  fee_kobo: string;
  net_amount_kobo: string;
  reference: string;
  provider_ref: string | null; // Providus/Paystack reference
  narration: string | null;
  card_id: string | null; // for card deposits
  created_at: Date;
  completed_at: Date | null;
}

// ---------------------------------------------------------------------------
// Processor responses (stubbed — production calls real APIs)
// ---------------------------------------------------------------------------

export interface ProvidusVirtualAccountResponse {
  success: boolean;
  account_number: string;
  account_name: string;
  bank_name: string;
  bank_code: string;
  provider_ref: string;
}

export interface PaystackCardVerifyResponse {
  success: boolean;
  last4: string;
  card_type: string;
  bank: string;
  expiry_month: string;
  expiry_year: string;
  reusable: boolean;
  authorization_code: string;
}
