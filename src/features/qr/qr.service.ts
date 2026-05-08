import * as crypto from 'crypto';
import { prisma } from '../../common/utils/prisma';
import { AppError, ErrorCode } from '../../common/errors/AppError';
import { logger } from '../../common/utils/logger';
import { signPayload, verifySignature, encodePayload, decodePayloadString } from './qr.crypto';
import type { QrCodeRecord, DecodedQr, QrPayload, QrCodeType } from './qr.types';
import type { GenerateQrInput } from './qr.schema';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

// ---------------------------------------------------------------------------
// POST /qr/generate
// ---------------------------------------------------------------------------

export async function generateQrCode(
  userId: string,
  input: GenerateQrInput,
): Promise<QrCodeRecord> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const wallet = (await db.wallet.findUnique({
    where: { user_id: userId },
    select: { id: true },
  })) as { id: string } | null;

  if (!wallet) throw new AppError(ErrorCode.NOT_FOUND, 'Wallet not found.');

  const qrId = crypto.randomUUID();
  const nonce = crypto.randomBytes(8).toString('hex');
  const amountKobo = input.type === 'dynamic' ? input.amount_kobo : undefined;
  const narration = input.narration ?? null;
  const expiresAt =
    input.type === 'dynamic' ? new Date(Date.now() + input.expires_in_minutes * 60 * 1000) : null;

  const payload: QrPayload = {
    v: 1,
    type: input.type,
    qr_id: qrId,
    wallet_id: wallet.id,
    nonce,
    ...(amountKobo !== undefined && { amount_kobo: amountKobo }),
    ...(expiresAt !== null && { expires_at: expiresAt.toISOString() }),
  };

  const payloadJson = JSON.stringify(payload);
  const hmacSig = signPayload(payloadJson);
  const encodedPayload = encodePayload(payload);

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const record = (await db.qrCode.create({
    data: {
      id: qrId,
      user_id: userId,
      type: input.type,
      amount: amountKobo !== undefined ? BigInt(amountKobo) : null,
      narration,
      payload: encodedPayload,
      hmac_sig: hmacSig,
      expires_at: expiresAt,
      is_active: true,
    },
  })) as {
    id: string;
    user_id: string;
    type: string;
    amount: bigint | null;
    narration: string | null;
    payload: string;
    hmac_sig: string;
    expires_at: Date | null;
    is_active: boolean;
    created_at: Date;
  };

  logger.info('QR code generated', {
    qr_id: qrId,
    user_id: userId,
    type: input.type,
    ...(amountKobo !== undefined && { amount_kobo: amountKobo }),
  });

  return toRecord(record, wallet.id);
}

// ---------------------------------------------------------------------------
// POST /qr/decode
// ---------------------------------------------------------------------------

export async function decodeQrCode(
  encodedPayload: string,
  requestingUserId: string,
): Promise<DecodedQr> {
  const payload = decodePayloadString(encodedPayload);

  if (payload.v !== 1) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'Unsupported QR code version.');
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const record = (await db.qrCode.findUnique({
    where: { id: payload.qr_id },
    select: {
      id: true,
      user_id: true,
      type: true,
      amount: true,
      narration: true,
      payload: true,
      hmac_sig: true,
      expires_at: true,
      is_active: true,
      user: { select: { wallet: { select: { id: true } } } },
    },
  })) as {
    id: string;
    user_id: string;
    type: string;
    amount: bigint | null;
    narration: string | null;
    payload: string;
    hmac_sig: string;
    expires_at: Date | null;
    is_active: boolean;
    user: { wallet: { id: string } | null } | null;
  } | null;

  if (!record) throw new AppError(ErrorCode.NOT_FOUND, 'QR code not found.');

  // Verify stored HMAC
  if (!verifySignature(record.payload, record.hmac_sig)) {
    logger.warn('QR HMAC verification failed', { qr_id: payload.qr_id });
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'QR code signature is invalid.');
  }

  // Verify submitted payload matches stored payload
  if (encodedPayload !== record.payload) {
    logger.warn('QR payload mismatch', { qr_id: payload.qr_id });
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'QR code has been tampered with.');
  }

  if (!record.is_active) {
    throw new AppError(ErrorCode.CONFLICT, 'This QR code is no longer active.');
  }

  if (record.expires_at && record.expires_at < new Date()) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    await db.qrCode.update({ where: { id: record.id }, data: { is_active: false } });
    throw new AppError(ErrorCode.CONFLICT, 'This QR code has expired.');
  }

  if (record.user_id === requestingUserId) {
    throw new AppError(ErrorCode.CONFLICT, 'You cannot pay yourself via QR code.');
  }

  const walletId = record.user?.wallet?.id;
  if (!walletId) throw new AppError(ErrorCode.NOT_FOUND, 'QR code owner wallet not found.');

  logger.info('QR code decoded', {
    qr_id: record.id,
    type: record.type,
    requesting_user: requestingUserId,
  });

  return {
    qr_id: record.id,
    wallet_id: walletId,
    type: record.type as QrCodeType,
    amount_kobo: record.amount !== null ? record.amount.toString() : null,
    narration: record.narration,
    expires_at: record.expires_at,
    is_active: record.is_active,
    recipient_wallet_id: walletId,
    suggested_amount_kobo: record.amount !== null ? record.amount.toString() : null,
  };
}

// ---------------------------------------------------------------------------
// GET /qr/:id
// ---------------------------------------------------------------------------

export async function getQrCode(qrId: string, userId: string): Promise<QrCodeRecord> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const record = (await db.qrCode.findUnique({
    where: { id: qrId },
    select: {
      id: true,
      user_id: true,
      type: true,
      amount: true,
      narration: true,
      payload: true,
      hmac_sig: true,
      expires_at: true,
      is_active: true,
      created_at: true,
      user: { select: { wallet: { select: { id: true } } } },
    },
  })) as DbQrRecord | null;

  if (!record) throw new AppError(ErrorCode.NOT_FOUND, 'QR code not found.');
  if (record.user_id !== userId)
    throw new AppError(ErrorCode.FORBIDDEN, 'You do not have access to this QR code.');

  return toRecord(record, record.user?.wallet?.id ?? '');
}

// ---------------------------------------------------------------------------
// DELETE /qr/:id
// ---------------------------------------------------------------------------

export async function deactivateQrCode(qrId: string, userId: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const record = (await db.qrCode.findUnique({
    where: { id: qrId },
    select: { id: true, user_id: true, is_active: true },
  })) as { id: string; user_id: string; is_active: boolean } | null;

  if (!record) throw new AppError(ErrorCode.NOT_FOUND, 'QR code not found.');
  if (record.user_id !== userId)
    throw new AppError(ErrorCode.FORBIDDEN, 'You do not own this QR code.');
  if (!record.is_active) throw new AppError(ErrorCode.CONFLICT, 'QR code is already inactive.');

  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  await db.qrCode.update({ where: { id: qrId }, data: { is_active: false } });

  logger.info('QR code deactivated', { qr_id: qrId, user_id: userId });
}

// ---------------------------------------------------------------------------
// GET /qr
// ---------------------------------------------------------------------------

export async function listQrCodes(userId: string): Promise<QrCodeRecord[]> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const rows = (await db.qrCode.findMany({
    where: { user_id: userId, is_active: true },
    orderBy: { created_at: 'desc' },
    select: {
      id: true,
      user_id: true,
      type: true,
      amount: true,
      narration: true,
      payload: true,
      hmac_sig: true,
      expires_at: true,
      is_active: true,
      created_at: true,
      user: { select: { wallet: { select: { id: true } } } },
    },
  })) as DbQrRecord[];

  return rows.map((r) => toRecord(r, r.user?.wallet?.id ?? ''));
}

// ---------------------------------------------------------------------------
// Internal types and mappers
// ---------------------------------------------------------------------------

interface DbQrRecord {
  id: string;
  user_id: string;
  type: string;
  amount: bigint | null;
  narration: string | null;
  payload: string;
  hmac_sig: string;
  expires_at: Date | null;
  is_active: boolean;
  created_at: Date;
  user?: { wallet: { id: string } | null } | null;
}

function toRecord(r: DbQrRecord, walletId: string): QrCodeRecord {
  return {
    id: r.id,
    user_id: r.user_id,
    wallet_id: walletId,
    type: r.type as QrCodeType,
    amount_kobo: r.amount !== null ? r.amount.toString() : null,
    narration: r.narration,
    payload: r.payload,
    hmac_sig: r.hmac_sig,
    expires_at: r.expires_at,
    is_active: r.is_active,
    created_at: r.created_at,
  };
}
