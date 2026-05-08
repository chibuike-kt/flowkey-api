export type QrCodeType = 'static' | 'dynamic';

export interface QrPayload {
  v: 1; // schema version — bump on breaking changes
  type: QrCodeType;
  qr_id: string; // qr_codes.id — for server-side lookup
  wallet_id: string;
  amount_kobo?: number; // only on dynamic QR
  nonce: string; // random per-generation value
  expires_at?: string; // ISO timestamp — only on dynamic QR
}

export interface QrCodeRecord {
  id: string;
  user_id: string;
  wallet_id: string;
  type: QrCodeType;
  amount_kobo: string | null; // null for static
  narration: string | null;
  payload: string; // JSON-serialised QrPayload
  hmac_sig: string; // HMAC-SHA256 of payload
  expires_at: Date | null;
  is_active: boolean;
  created_at: Date;
}

export interface DecodedQr {
  qr_id: string;
  wallet_id: string;
  type: QrCodeType;
  amount_kobo: string | null; // null means sender chooses amount
  narration: string | null;
  expires_at: Date | null;
  is_active: boolean;
  // Ready-to-use fields for POST /transfers/internal
  recipient_wallet_id: string;
  suggested_amount_kobo: string | null;
}
