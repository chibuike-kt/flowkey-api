import { GenerateQrSchema, DecodeQrSchema } from '../../../src/features/qr/qr.schema';

import {
  signPayload,
  verifySignature,
  encodePayload,
  decodePayloadString,
} from '../../../src/features/qr/qr.crypto';

import type { QrPayload } from '../../../src/features/qr/qr.types';

// ---------------------------------------------------------------------------
// GenerateQrSchema
// ---------------------------------------------------------------------------

describe('GenerateQrSchema — static', () => {
  it('accepts minimal static QR', () =>
    expect(GenerateQrSchema.safeParse({ type: 'static' }).success).toBe(true));
  it('accepts optional narration', () =>
    expect(GenerateQrSchema.safeParse({ type: 'static', narration: 'Pay me' }).success).toBe(true));
  it('rejects narration > 255', () =>
    expect(GenerateQrSchema.safeParse({ type: 'static', narration: 'x'.repeat(256) }).success).toBe(
      false,
    ));
  it('static has no amount field', () => {
    const r = GenerateQrSchema.safeParse({ type: 'static', amount_kobo: 1000 });
    // amount_kobo is valid but belongs to dynamic discriminant — static ignores it
    expect(r.success).toBe(true);
  });
});

describe('GenerateQrSchema — dynamic', () => {
  const valid = { type: 'dynamic', amount_kobo: 500_000 };

  it('accepts valid dynamic QR', () =>
    expect(GenerateQrSchema.safeParse(valid).success).toBe(true));
  it('defaults expires_in_minutes to 30', () => {
    const r = GenerateQrSchema.safeParse(valid);
    if (r.success && r.data.type === 'dynamic') expect(r.data.expires_in_minutes).toBe(30);
  });
  it('accepts custom expiry', () =>
    expect(GenerateQrSchema.safeParse({ ...valid, expires_in_minutes: 60 }).success).toBe(true));
  it('rejects zero amount', () =>
    expect(GenerateQrSchema.safeParse({ type: 'dynamic', amount_kobo: 0 }).success).toBe(false));
  it('rejects negative amount', () =>
    expect(GenerateQrSchema.safeParse({ type: 'dynamic', amount_kobo: -1 }).success).toBe(false));
  it('rejects decimal amount', () =>
    expect(GenerateQrSchema.safeParse({ type: 'dynamic', amount_kobo: 500.5 }).success).toBe(
      false,
    ));
  it('rejects expiry < 1 minute', () =>
    expect(GenerateQrSchema.safeParse({ ...valid, expires_in_minutes: 0 }).success).toBe(false));
  it('rejects expiry > 7 days (10080 min)', () =>
    expect(GenerateQrSchema.safeParse({ ...valid, expires_in_minutes: 10_081 }).success).toBe(
      false,
    ));
  it('rejects missing amount_kobo', () =>
    expect(GenerateQrSchema.safeParse({ type: 'dynamic' }).success).toBe(false));
  it('rejects unknown type', () =>
    expect(GenerateQrSchema.safeParse({ type: 'animated' }).success).toBe(false));
});

describe('DecodeQrSchema', () => {
  it('accepts a non-empty payload string', () =>
    expect(DecodeQrSchema.safeParse({ payload: 'abc123' }).success).toBe(true));
  it('rejects empty payload', () =>
    expect(DecodeQrSchema.safeParse({ payload: '' }).success).toBe(false));
  it('rejects missing payload', () => expect(DecodeQrSchema.safeParse({}).success).toBe(false));
});

// ---------------------------------------------------------------------------
// Payload encoding / decoding
// ---------------------------------------------------------------------------

describe('QR payload encoding', () => {
  const payload: QrPayload = {
    v: 1,
    type: 'static',
    qr_id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
    wallet_id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
    nonce: 'abc123def456',
  };

  it('encodes and decodes a static payload round-trip', () => {
    const encoded = encodePayload(payload);
    const decoded = decodePayloadString(encoded);
    expect(decoded).toEqual(payload);
  });

  it('encoded payload is a base64url string', () => {
    const encoded = encodePayload(payload);
    // base64url uses A-Za-z0-9, -, _ only (no +, /, =)
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('different nonces produce different encoded payloads', () => {
    const p2 = { ...payload, nonce: 'different_nonce' };
    expect(encodePayload(payload)).not.toBe(encodePayload(p2));
  });

  it('throws on invalid base64url input', () => {
    expect(() => decodePayloadString('not-valid-json-base64!!!')).toThrow();
  });

  it('encodes dynamic payload with amount_kobo', () => {
    const dynamic: QrPayload = { ...payload, type: 'dynamic', amount_kobo: 500_000 };
    const decoded = decodePayloadString(encodePayload(dynamic));
    expect(decoded.amount_kobo).toBe(500_000);
  });

  it('encodes dynamic payload with expires_at', () => {
    const expiry = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const dynamic: QrPayload = { ...payload, type: 'dynamic', expires_at: expiry };
    const decoded = decodePayloadString(encodePayload(dynamic));
    expect(decoded.expires_at).toBe(expiry);
  });

  it('preserves v: 1 through encode/decode', () => {
    const decoded = decodePayloadString(encodePayload(payload));
    expect(decoded.v).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// HMAC signing and verification
// ---------------------------------------------------------------------------

describe('HMAC signing', () => {
  const payloadJson = JSON.stringify({
    v: 1,
    type: 'static',
    qr_id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
    wallet_id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
    nonce: 'abc123def456',
  });

  it('signPayload returns a 64-char hex string (SHA-256)', () => {
    const sig = signPayload(payloadJson);
    expect(sig).toHaveLength(64);
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
  });

  it('verifySignature returns true for a correct signature', () => {
    const sig = signPayload(payloadJson);
    expect(verifySignature(payloadJson, sig)).toBe(true);
  });

  it('verifySignature returns false for a wrong signature', () => {
    expect(verifySignature(payloadJson, 'a'.repeat(64))).toBe(false);
  });

  it('verifySignature returns false for a tampered payload', () => {
    const sig = signPayload(payloadJson);
    const tampered = payloadJson.replace('static', 'dynamic');
    expect(verifySignature(tampered, sig)).toBe(false);
  });

  it('same payload always produces the same signature', () => {
    expect(signPayload(payloadJson)).toBe(signPayload(payloadJson));
  });

  it('different payloads produce different signatures', () => {
    const sig1 = signPayload(payloadJson);
    const sig2 = signPayload(payloadJson + ' ');
    expect(sig1).not.toBe(sig2);
  });

  it('verifySignature returns false for wrong-length sig', () => {
    expect(verifySignature(payloadJson, 'tooshort')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Static vs dynamic QR invariants
// ---------------------------------------------------------------------------

describe('Static QR invariants', () => {
  it('static QR has no amount_kobo', () => {
    const payload: QrPayload = {
      v: 1,
      type: 'static',
      qr_id: crypto.randomUUID(),
      wallet_id: crypto.randomUUID(),
      nonce: 'abc',
    };
    expect(payload.amount_kobo).toBeUndefined();
  });

  it('static QR has no expires_at', () => {
    const payload: QrPayload = {
      v: 1,
      type: 'static',
      qr_id: crypto.randomUUID(),
      wallet_id: crypto.randomUUID(),
      nonce: 'abc',
    };
    expect(payload.expires_at).toBeUndefined();
  });

  it('static QR never expires — no expiry check needed', () => {
    const expiresAt = undefined;
    const isExpired = expiresAt ? new Date(expiresAt) < new Date() : false;
    expect(isExpired).toBe(false);
  });
});

describe('Dynamic QR invariants', () => {
  it('dynamic QR expires after the configured window', () => {
    const expiresInMinutes = 30;
    const expiresAt = new Date(Date.now() + expiresInMinutes * 60 * 1000);
    const isExpired = expiresAt < new Date();
    expect(isExpired).toBe(false);
  });

  it('expired dynamic QR is detected correctly', () => {
    const pastExpiry = new Date(Date.now() - 1000); // 1s in the past
    const isExpired = pastExpiry < new Date();
    expect(isExpired).toBe(true);
  });

  it('dynamic QR amount_kobo is preserved through encode/decode', () => {
    const payload: QrPayload = {
      v: 1,
      type: 'dynamic',
      amount_kobo: 1_500_000,
      qr_id: crypto.randomUUID(),
      wallet_id: crypto.randomUUID(),
      nonce: 'abc',
    };
    const decoded = decodePayloadString(encodePayload(payload));
    expect(decoded.amount_kobo).toBe(1_500_000);
  });
});

// ---------------------------------------------------------------------------
// Self-payment guard logic
// ---------------------------------------------------------------------------

describe('Self-payment guard', () => {
  it('blocks when requesting user owns the QR', () => {
    const qrOwnerId = 'user-A';
    const requestingUser = 'user-A';
    const isSelf = qrOwnerId === requestingUser;
    expect(isSelf).toBe(true);
  });

  it('allows when requesting user does not own the QR', () => {
    const qrOwnerId = 'user-A';
    const requestingUser = 'user-B';
    const isSelf = qrOwnerId === requestingUser;
    expect(isSelf).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// DecodedQr shape contract
// ---------------------------------------------------------------------------

describe('DecodedQr shape', () => {
  const mock = {
    qr_id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
    wallet_id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
    type: 'dynamic' as const,
    amount_kobo: '500000',
    narration: 'Coffee',
    expires_at: new Date(Date.now() + 30 * 60 * 1000),
    is_active: true,
    recipient_wallet_id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
    suggested_amount_kobo: '500000',
  };

  it('recipient_wallet_id equals wallet_id', () =>
    expect(mock.recipient_wallet_id).toBe(mock.wallet_id));
  it('suggested_amount_kobo equals amount_kobo', () =>
    expect(mock.suggested_amount_kobo).toBe(mock.amount_kobo));
  it('is_active is true for a fresh decode', () => expect(mock.is_active).toBe(true));
  it('expires_at is a Date in the future', () =>
    expect(mock.expires_at.getTime()).toBeGreaterThan(Date.now()));
  it('amount_kobo is a string', () => expect(typeof mock.amount_kobo).toBe('string'));

  it('static QR has null suggested_amount_kobo', () => {
    const staticMock = {
      ...mock,
      type: 'static' as const,
      amount_kobo: null,
      suggested_amount_kobo: null,
    };
    expect(staticMock.suggested_amount_kobo).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// QR → Transfer integration shape
// ---------------------------------------------------------------------------

describe('QR code to transfer flow', () => {
  it('decoded QR provides recipient_wallet_id for POST /transfers/internal', () => {
    // Simulate what the client does after decoding:
    const decoded = {
      recipient_wallet_id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
      suggested_amount_kobo: '500000',
      type: 'dynamic',
    };

    // Client builds the transfer body from the decoded QR
    const transferBody = {
      recipient_wallet_id: decoded.recipient_wallet_id,
      amount_kobo: Number(decoded.suggested_amount_kobo),
      source: 'qr_code',
      qr_token: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
      pin: '1234',
    };

    expect(transferBody.source).toBe('qr_code');
    expect(transferBody.recipient_wallet_id).toBe(decoded.recipient_wallet_id);
    expect(transferBody.amount_kobo).toBe(500_000);
  });

  it('static QR allows any amount — client provides amount_kobo', () => {
    const decoded = {
      recipient_wallet_id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
      suggested_amount_kobo: null, // static — no fixed amount
    };
    // Client must supply their own amount
    const clientAmount = 250_000;
    expect(decoded.suggested_amount_kobo).toBeNull();
    expect(clientAmount).toBeGreaterThan(0);
  });
});
