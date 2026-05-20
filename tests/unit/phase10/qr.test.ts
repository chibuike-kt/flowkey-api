import { DecodeQrSchema } from '../../../src/features/qr/qr.schema';
import {
  signPayload,
  verifySignature,
  encodePayload,
  decodePayloadString,
} from '../../../src/features/qr/qr.crypto';
import type { QrPayload } from '../../../src/features/qr/qr.types';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

describe('DecodeQrSchema', () => {
  it('accepts a valid payload string', () =>
    expect(DecodeQrSchema.safeParse({ payload: 'abc123' }).success).toBe(true));
  it('rejects empty payload', () =>
    expect(DecodeQrSchema.safeParse({ payload: '' }).success).toBe(false));
  it('rejects missing payload', () => expect(DecodeQrSchema.safeParse({}).success).toBe(false));
});

// ---------------------------------------------------------------------------
// Crypto
// ---------------------------------------------------------------------------

describe('QR crypto', () => {
  const payload: QrPayload = {
    v: 1,
    wallet_id: 'wallet-uuid-123',
    username: 'kingsley_kt',
    qr_id: 'qr-uuid-456',
    nonce: 'abc123nonce',
  };

  const payloadJson = JSON.stringify(payload);

  it('signs a payload without throwing', () => {
    expect(() => signPayload(payloadJson)).not.toThrow();
  });

  it('produces a 64-char hex HMAC', () => {
    const sig = signPayload(payloadJson);
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
  });

  it('verifies a valid signature', () => {
    const sig = signPayload(payloadJson);
    expect(verifySignature(payloadJson, sig)).toBe(true);
  });

  it('rejects a tampered payload', () => {
    const sig = signPayload(payloadJson);
    const tampered = JSON.stringify({ ...payload, wallet_id: 'different-wallet' });
    expect(verifySignature(tampered, sig)).toBe(false);
  });

  it('rejects a tampered signature', () => {
    const sig = signPayload(payloadJson);
    const badSig = sig.slice(0, -2) + '00';
    expect(verifySignature(payloadJson, badSig)).toBe(false);
  });

  it('encodes payload to base64url', () => {
    const encoded = encodePayload(payload);
    expect(encoded).not.toContain('+');
    expect(encoded).not.toContain('/');
    expect(encoded).not.toContain('=');
  });

  it('decodes back to original payload', () => {
    const encoded = encodePayload(payload);
    const decoded = decodePayloadString(encoded);
    expect(decoded.wallet_id).toBe(payload.wallet_id);
    expect(decoded.username).toBe(payload.username);
    expect(decoded.qr_id).toBe(payload.qr_id);
    expect(decoded.v).toBe(1);
  });

  it('throws on malformed base64url', () => {
    expect(() => decodePayloadString('not-valid-json!!!')).toThrow();
  });

  it('round-trip: encode → decode → re-sign verifies', () => {
    const encoded = encodePayload(payload);
    const decoded = decodePayloadString(encoded) as QrPayload;
    const reSigned = signPayload(JSON.stringify(decoded));
    expect(verifySignature(JSON.stringify(decoded), reSigned)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// QR payload structure
// ---------------------------------------------------------------------------

describe('QR payload structure', () => {
  it('permanent QR has no amount_kobo', () => {
    const p: QrPayload = {
      v: 1,
      wallet_id: 'w',
      username: 'u',
      qr_id: 'q',
      nonce: 'n',
    };
    expect('amount_kobo' in p).toBe(false);
  });

  it('permanent QR has no expires_at', () => {
    const p: QrPayload = {
      v: 1,
      wallet_id: 'w',
      username: 'u',
      qr_id: 'q',
      nonce: 'n',
    };
    expect('expires_at' in p).toBe(false);
  });

  it('payload encodes wallet_id and username', () => {
    const p: QrPayload = {
      v: 1,
      wallet_id: 'wallet-abc',
      username: 'test_user',
      qr_id: 'q',
      nonce: 'n',
    };
    const encoded = encodePayload(p);
    const decoded = decodePayloadString(encoded) as QrPayload;
    expect(decoded.wallet_id).toBe('wallet-abc');
    expect(decoded.username).toBe('test_user');
  });
});

// ---------------------------------------------------------------------------
// QR flow integration (pure logic, no DB)
// ---------------------------------------------------------------------------

describe('QR payment flow', () => {
  it('scan → decode → pre-fill transfer form', () => {
    // Simulate receiver's QR being scanned
    const receiverPayload: QrPayload = {
      v: 1,
      wallet_id: 'receiver-wallet-uuid',
      username: 'receiver_user',
      qr_id: 'qr-uuid',
      nonce: 'random123',
    };

    const encoded = encodePayload(receiverPayload);
    const decoded = decodePayloadString(encoded) as QrPayload;

    // App pre-fills transfer form from decoded data
    const transferFormData = {
      recipient_wallet_id: decoded.wallet_id,
      source: 'qr_code' as const,
    };

    expect(transferFormData.recipient_wallet_id).toBe('receiver-wallet-uuid');
    expect(transferFormData.source).toBe('qr_code');
    // Amount and narration are entered by the sender — not in QR
  });

  it('tampered QR fails verification', () => {
    const originalPayload: QrPayload = {
      v: 1,
      wallet_id: 'original-wallet',
      username: 'user',
      qr_id: 'q',
      nonce: 'n',
    };
    const payloadJson = JSON.stringify(originalPayload);
    const sig = signPayload(payloadJson);

    // Attacker modifies wallet_id to redirect payment
    const tamperedPayload = { ...originalPayload, wallet_id: 'attacker-wallet' };
    const tamperedJson = JSON.stringify(tamperedPayload);

    expect(verifySignature(tamperedJson, sig)).toBe(false);
  });
});
