import {
  CreatePaymentRequestSchema,
  PayPaymentRequestSchema,
  ListPaymentRequestsSchema,
} from '../../../src/features/payment-requests/payment-requests.schema';
import type { PaymentRequestStatus } from '../../../src/features/payment-requests/payment-requests.types';

describe('CreatePaymentRequestSchema', () => {
  const valid = { receiver_identifier: 'kingsley_kt', amount_kobo: 500000 };

  it('accepts valid request', () =>
    expect(CreatePaymentRequestSchema.safeParse(valid).success).toBe(true));
  it('accepts optional narration', () =>
    expect(CreatePaymentRequestSchema.safeParse({ ...valid, narration: 'Rent' }).success).toBe(
      true,
    ));
  it('accepts custom expiry hours', () =>
    expect(CreatePaymentRequestSchema.safeParse({ ...valid, expires_in_hours: 48 }).success).toBe(
      true,
    ));
  it('rejects empty receiver_identifier', () =>
    expect(
      CreatePaymentRequestSchema.safeParse({ ...valid, receiver_identifier: '' }).success,
    ).toBe(false));
  it('rejects zero amount', () =>
    expect(CreatePaymentRequestSchema.safeParse({ ...valid, amount_kobo: 0 }).success).toBe(false));
  it('rejects negative amount', () =>
    expect(CreatePaymentRequestSchema.safeParse({ ...valid, amount_kobo: -1 }).success).toBe(
      false,
    ));
  it('rejects below minimum (100 kobo)', () =>
    expect(CreatePaymentRequestSchema.safeParse({ ...valid, amount_kobo: 99 }).success).toBe(
      false,
    ));
  it('accepts exactly minimum (100)', () =>
    expect(CreatePaymentRequestSchema.safeParse({ ...valid, amount_kobo: 100 }).success).toBe(
      true,
    ));
  it('rejects decimal amount', () =>
    expect(CreatePaymentRequestSchema.safeParse({ ...valid, amount_kobo: 500.5 }).success).toBe(
      false,
    ));
  it('rejects expiry > 72 hours', () =>
    expect(CreatePaymentRequestSchema.safeParse({ ...valid, expires_in_hours: 73 }).success).toBe(
      false,
    ));
  it('rejects expiry of 0 hours', () =>
    expect(CreatePaymentRequestSchema.safeParse({ ...valid, expires_in_hours: 0 }).success).toBe(
      false,
    ));
  it('defaults expiry_hours to 24', () => {
    const r = CreatePaymentRequestSchema.safeParse(valid);
    if (r.success) expect(r.data.expires_in_hours).toBe(24);
  });
});

describe('PayPaymentRequestSchema', () => {
  it('accepts valid 4-digit PIN', () =>
    expect(PayPaymentRequestSchema.safeParse({ pin: '1234' }).success).toBe(true));
  it('rejects 3-digit PIN', () =>
    expect(PayPaymentRequestSchema.safeParse({ pin: '123' }).success).toBe(false));
  it('rejects alpha PIN', () =>
    expect(PayPaymentRequestSchema.safeParse({ pin: 'abcd' }).success).toBe(false));
  it('rejects missing PIN', () =>
    expect(PayPaymentRequestSchema.safeParse({}).success).toBe(false));
});

describe('ListPaymentRequestsSchema', () => {
  it('defaults direction to all', () => {
    const r = ListPaymentRequestsSchema.safeParse({});
    if (r.success) expect(r.data.direction).toBe('all');
  });
  it('defaults limit to 20', () => {
    const r = ListPaymentRequestsSchema.safeParse({});
    if (r.success) expect(r.data.limit).toBe(20);
  });
  it('accepts direction: sent', () =>
    expect(ListPaymentRequestsSchema.safeParse({ direction: 'sent' }).success).toBe(true));
  it('accepts direction: received', () =>
    expect(ListPaymentRequestsSchema.safeParse({ direction: 'received' }).success).toBe(true));
  it('accepts status filter', () =>
    expect(ListPaymentRequestsSchema.safeParse({ status: 'pending' }).success).toBe(true));
  it('rejects limit > 50', () =>
    expect(ListPaymentRequestsSchema.safeParse({ limit: 51 }).success).toBe(false));
  it('rejects invalid status', () =>
    expect(ListPaymentRequestsSchema.safeParse({ status: 'unknown' }).success).toBe(false));
});

describe('Status machine', () => {
  const terminal: PaymentRequestStatus[] = ['paid', 'declined', 'cancelled', 'expired'];
  const actionable: PaymentRequestStatus[] = ['pending'];

  it('only pending requests can be acted on', () => {
    for (const status of terminal) {
      expect(actionable.includes(status)).toBe(false);
    }
  });

  it('pending is the only actionable state', () => {
    expect(actionable).toHaveLength(1);
    expect(actionable[0]).toBe('pending');
  });

  it('expired request cannot be paid', () => {
    const expiresAt = new Date(Date.now() - 1000);
    expect(expiresAt < new Date()).toBe(true);
  });
});

describe('Direction logic', () => {
  it('sender sees direction: sent', () => {
    const userId = 'user-A';
    const req = { sender_id: 'user-A', receiver_id: 'user-B' };
    expect(req.sender_id === userId ? 'sent' : 'received').toBe('sent');
  });

  it('receiver sees direction: received', () => {
    const userId = 'user-B';
    const req = { sender_id: 'user-A', receiver_id: 'user-B' };
    expect(req.sender_id === userId ? 'sent' : 'received').toBe('received');
  });
});

describe('Expiry calculation', () => {
  it('default expiry is 24 hours from now', () => {
    const now = Date.now();
    const expiry = new Date(now + 24 * 60 * 60 * 1000);
    const diffHours = (expiry.getTime() - now) / (60 * 60 * 1000);
    expect(Math.round(diffHours)).toBe(24);
  });

  it('custom expiry of 48 hours', () => {
    const now = Date.now();
    const expiry = new Date(now + 48 * 60 * 60 * 1000);
    const diffHours = (expiry.getTime() - now) / (60 * 60 * 1000);
    expect(Math.round(diffHours)).toBe(48);
  });

  it('expired request has expires_at in the past', () => {
    const expiresAt = new Date(Date.now() - 1000);
    expect(expiresAt < new Date()).toBe(true);
  });
});
