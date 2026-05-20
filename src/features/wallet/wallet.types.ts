export interface WalletBalance {
  wallet_id: string;
  balance_kobo: string;
  ledger_credit_kobo: string;
  ledger_debit_kobo: string;
  last_updated_at: Date | null;
  universal_id: string;
  kyc_tier: number;
  currency: string;
}

// ---------------------------------------------------------------------------
// Transaction list item — shown in the history feed
// ---------------------------------------------------------------------------

export type TransactionDirection = 'credit' | 'debit';

export type TransactionLabel =
  | 'Money Received'
  | 'Transfer Sent'
  | 'Bank Transfer'
  | 'Deposit — Bank Transfer'
  | 'Deposit — Card'
  | 'Reversal'
  | 'Transfer';

export interface TransactionListItem {
  id: string;
  transaction_number: string; // TXN-8AD496
  reference: string;
  type: string; // internal type: transfer_internal etc
  label: TransactionLabel; // human label
  status: string;
  direction: TransactionDirection;
  amount_kobo: string;
  fee_kobo: string;
  net_amount_kobo: string;
  narration: string | null;
  counterparty: string | null; // display name of the other party
  payment_method: string;
  created_at: Date;
  completed_at: Date | null;
}

// ---------------------------------------------------------------------------
// Transaction detail — shown when tapping a history item
// ---------------------------------------------------------------------------

export interface TransactionDetail {
  id: string;
  transaction_number: string;
  reference: string;
  type: string;
  label: TransactionLabel;
  status: string;
  direction: TransactionDirection;
  payment_method: string;
  amount_kobo: string;
  fee_kobo: string;
  net_amount_kobo: string;
  narration: string | null;
  created_at: Date;
  completed_at: Date | null;
  // Counterparty — populated based on transaction type
  sender: CounterpartyDetail | null;
  recipient: CounterpartyDetail | BankCounterparty | null;
  // Receipt
  receipt_url: string | null;
}

export interface CounterpartyDetail {
  display_name: string;
  username: string | null;
  wallet_id: string;
}

export interface BankCounterparty {
  account_number: string; // masked ****6789
  account_name: string;
  bank_name: string;
  bank_code: string;
}

export interface TransactionListResult {
  transactions: TransactionListItem[];
  next_cursor: string | null;
}
