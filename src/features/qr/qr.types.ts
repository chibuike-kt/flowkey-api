export interface QrPayload {
  v: 1; // schema version
  wallet_id: string;
  username: string;
  qr_id: string; // qr_codes.id — for server-side lookup
  nonce: string; // random value, prevents payload reuse
}

export interface UserQrCode {
  id: string;
  payload: string; // base64url — this is what gets encoded into the QR image
  username: string;
  wallet_id: string;
  is_active: boolean;
  created_at: Date;
}

export interface DecodedQr {
  recipient_wallet_id: string;
  display_name: string;
  username: string;
}
