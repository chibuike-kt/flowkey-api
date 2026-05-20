import * as crypto from 'crypto';

const PROVIDUS_SECRET = process.env['PROVIDUS_WEBHOOK_SECRET'] ?? 'providus-dev-secret';
const PAYSTACK_SECRET = process.env['PAYSTACK_SECRET_KEY'] ?? 'paystack-dev-secret';

export function verifyProvidusSignature(rawBody: string, signature: string): boolean {
  const expected = crypto.createHmac('sha512', PROVIDUS_SECRET).update(rawBody).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature, 'hex'));
  } catch {
    return false;
  }
}

export function verifyPaystackSignature(rawBody: string, signature: string): boolean {
  const expected = crypto.createHmac('sha512', PAYSTACK_SECRET).update(rawBody).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature, 'hex'));
  } catch {
    return false;
  }
}
