export type TransferSource = 'username' | 'qr_code' | 'universal_id' | 'api';

export type PaymentMethod =
  | 'FlowKey to FlowKey'
  | 'FlowKey to Bank'
  | 'Universal ID — FlowKey to FlowKey'
  | 'Universal ID — FlowKey to Bank'
  | 'QR Code';

export interface RecipientPreview {
  user_id: string;
  username: string;
  display_name: string | null;
  universal_id: string;
  wallet_id: string;
}

// ---------------------------------------------------------------------------
// Internal transfer result — rich response for payment details / receipt
// ---------------------------------------------------------------------------

export interface InternalTransferResult {
  transaction_id: string;
  transaction_number: string; // short human-readable e.g. TXN-8AD496
  reference: string; // full reference e.g. FLK-20260517-8AD496
  transaction_date: string; // ISO timestamp
  status: 'completed';
  payment_method: PaymentMethod;
  amount_kobo: string;
  fee_kobo: string;
  net_amount_kobo: string;
  narration: string | null;
  sender: {
    user_id: string;
    display_name: string;
    username: string;
    wallet_id: string;
  };
  recipient: {
    user_id: string;
    display_name: string;
    username: string;
    wallet_id: string;
  };
}

// ---------------------------------------------------------------------------
// Bank transfer result
// ---------------------------------------------------------------------------

export type BankTransferStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'reversed';

export interface BankTransferResult {
  transaction_id: string;
  transaction_number: string;
  reference: string;
  transaction_date: string;
  status: BankTransferStatus;
  payment_method: PaymentMethod;
  amount_kobo: string;
  fee_kobo: string;
  net_amount_kobo: string;
  narration: string | null;
  sender: {
    user_id: string;
    display_name: string;
    username: string;
    wallet_id: string;
  };
  recipient: {
    account_number: string; // masked: ****1234
    account_name: string;
    bank_name: string;
    bank_code: string;
  };
  estimated_settlement: string;
  completed_at: string | null;
}

// ---------------------------------------------------------------------------
// Transaction detail (GET /transfers/:id)
// ---------------------------------------------------------------------------

export interface TransactionDetail {
  id: string;
  type: string;
  status: string;
  amount_kobo: string;
  fee_kobo: string;
  net_amount_kobo: string;
  narration: string | null;
  reference: string;
  source: TransferSource | null;
  sender_wallet_id: string | null;
  receiver_wallet_id: string | null;
  initiator_id: string | null;
  metadata: Record<string, unknown> | null;
  completed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface FraudCheckResult {
  blocked: boolean;
  reason?: string;
  flagged: boolean;
  flag_reason?: string;
  velocity_count: number;
}

export interface BankProcessorResponse {
  success: boolean;
  processor_reference?: string;
  bank_response_code?: string;
  failure_reason?: string;
}
