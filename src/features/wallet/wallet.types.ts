export interface WalletBalance {
  wallet_id: string;
  balance_kobo: string; // total available balance
  ledger_credit_kobo: string; // lifetime credits
  ledger_debit_kobo: string; // lifetime debits
  last_updated_at: Date | null; // timestamp of last ledger entry
}

export interface TransactionListItem {
  id: string;
  type: string;
  status: string;
  amount_kobo: string;
  fee_kobo: string;
  net_amount_kobo: string;
  narration: string | null;
  reference: string;
  direction: 'credit' | 'debit' | null; // relative to this user's wallet
  counterparty_wallet_id: string | null;
  completed_at: Date | null;
  created_at: Date;
}

export interface TransactionListResult {
  transactions: TransactionListItem[];
  next_cursor: string | null;
}
