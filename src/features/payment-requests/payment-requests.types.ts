export type PaymentRequestStatus =
  | 'pending'
  | 'paid'
  | 'declined'
  | 'cancelled'
  | 'expired';

export interface PaymentRequest {
  id:          string;
  sender_id:   string;
  receiver_id: string;
  amount_kobo: string;
  narration:   string | null;
  status:      PaymentRequestStatus;
  expires_at:  Date;
  paid_at:     Date | null;
  created_at:  Date;
  updated_at:  Date;
  // Denormalised fields for display
  sender_name:   string | null;
  sender_username: string | null;
  receiver_name:   string | null;
  receiver_username: string | null;
}

export interface PaymentRequestListItem {
  id:          string;
  direction:   'sent' | 'received';
  amount_kobo: string;
  narration:   string | null;
  status:      PaymentRequestStatus;
  expires_at:  Date;
  paid_at:     Date | null;
  created_at:  Date;
  counterpart_name:     string;
  counterpart_username: string;
}
