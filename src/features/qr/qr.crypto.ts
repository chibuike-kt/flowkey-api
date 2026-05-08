import * as crypto from 'crypto';
import { AppError, ErrorCode } from '../../common/errors/AppError';
import type { QrPayload } from './qr.types';

const QR_HMAC_SECRET =
  process.env['QR_HMAC_SECRET'] ?? 'flowkey-qr-dev-secret-change-in-production';

export function signPayload(payloadJson: string): string {
  return crypto.createHmac('sha256', QR_HMAC_SECRET).update(payloadJson).digest('hex');
}

export function verifySignature(payloadJson: string, sig: string): boolean {
  const expected = signPayload(payloadJson);
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(sig, 'hex'));
  } catch {
    return false;
  }
}

export function encodePayload(payload: QrPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

export function decodePayloadString(encoded: string): QrPayload {
  try {
    const json = Buffer.from(encoded, 'base64url').toString('utf8');
    return JSON.parse(json) as QrPayload;
  } catch {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'Invalid QR payload encoding.');
  }
}

