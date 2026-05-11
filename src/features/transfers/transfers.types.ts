export type TransferSource =
  | 'username'
  | 'qr_code'
  | 'universal_id'
  | 'api';

// ---------------------------------------------------------------------------
// Recipient resolution
// ---------------------------------------------------------------------------

export interface RecipientPreview {
  user_id: string;
  username: string;
  display_name: string | null;
  universal_id: string;
  wallet_id: string;
}

// ---------------------------------------------------------------------------
// Internal transfer (FlowKey → FlowKey)
// ---------------------------------------------------------------------------

export interface InternalTransferResult {
  transaction_id: string;
  reference: string;
  status: 'completed';
  amount_kobo: string;
  fee_kobo: string;
  net_amount_kobo: string;
  narration: string | null;
  source: TransferSource;
  sender_wallet_id: string;
  receiver_wallet_id: string;
  uid_device_mismatch?: boolean; // true when UID auth used on foreign device
  created_at: Date;
}

// ---------------------------------------------------------------------------
// Bank transfer (FlowKey → Bank) — async lifecycle
// ---------------------------------------------------------------------------

export type BankTransferStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'reversed';

export interface BankTransferResult {
  transaction_id: string;
  reference: string;
  status: BankTransferStatus;
  amount_kobo: string;
  fee_kobo: string;
  net_amount_kobo: string;
  narration: string | null;
  recipient_account: string; // masked: ****1234
  recipient_bank_name: string;
  recipient_name: string;
  estimated_settlement: string; // ISO timestamp
  sender_wallet_id: string;
  created_at: Date;
  completed_at: Date | null;
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
  initiator_id: string;
  metadata: Record<string, unknown> | null;
  completed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

// ---------------------------------------------------------------------------
// Fraud check result
// ---------------------------------------------------------------------------

export interface FraudCheckResult {
  blocked: boolean;
  reason?: string; // if blocked
  flagged: boolean; // logged but not blocked
  flag_reason?: string;
  velocity_count: number; // transfers in last hour
}

// ---------------------------------------------------------------------------
// Bank processor stubs
// ---------------------------------------------------------------------------

export interface BankProcessorResponse {
  success: boolean;
  processor_reference?: string; // e.g. Paystack transfer_code
  bank_response_code?: string;
  failure_reason?: string;
}



