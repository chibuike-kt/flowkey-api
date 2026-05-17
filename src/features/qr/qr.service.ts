import * as crypto from 'crypto';
import { prisma } from '../../common/utils/prisma';
import { AppError, ErrorCode } from '../../common/errors/AppError';
import { logger } from '../../common/utils/logger';
import { signPayload, verifySignature, encodePayload, decodePayloadString } from './qr.crypto';
import type { UserQrCode, DecodedQr, QrPayload } from './qr.types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

// ---------------------------------------------------------------------------
// GET /qr/me — get or create the user's permanent QR code
// ---------------------------------------------------------------------------

export async function getMyQrCode(userId: string): Promise<UserQrCode> {
  // Load user + wallet
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const user = (await db.user.findUnique({
    where: { id: userId },
    select: {
      username: true,
      display_name: true,
      wallet: { select: { id: true } },
    },
  })) as { username: string; display_name: string | null; wallet: { id: string } | null } | null;

  if (!user?.wallet) throw new AppError(ErrorCode.NOT_FOUND, 'Wallet not found.');

  // Check if active QR already exists
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const existing = (await db.qrCode.findFirst({
    where: { user_id: userId, is_active: true },
    orderBy: { created_at: 'desc' },
    select: { id: true, payload: true, is_active: true, created_at: true },
  })) as { id: string; payload: string; is_active: boolean; created_at: Date } | null;

  if (existing) {
    return {
      id: existing.id,
      payload: existing.payload,
      username: user.username,
      wallet_id: user.wallet.id,
      is_active: existing.is_active,
      created_at: existing.created_at,
    };
  }

  // None exists — create one
  return createQrCode(userId, user.username, user.wallet.id);
}

// ---------------------------------------------------------------------------
// POST /qr/regenerate — invalidate current, issue new
// ---------------------------------------------------------------------------

export async function regenerateQrCode(userId: string): Promise<UserQrCode> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const user = (await db.user.findUnique({
    where: { id: userId },
    select: {
      username: true,
      wallet: { select: { id: true } },
    },
  })) as { username: string; wallet: { id: string } | null } | null;

  if (!user?.wallet) throw new AppError(ErrorCode.NOT_FOUND, 'Wallet not found.');

  // Deactivate all existing QR codes
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  await db.qrCode.updateMany({
    where: { user_id: userId, is_active: true },
    data: { is_active: false },
  });

  logger.info('QR code regenerated — old codes deactivated', { user_id: userId });

  return createQrCode(userId, user.username, user.wallet.id);
}

// ---------------------------------------------------------------------------
// POST /qr/decode — verify a scanned QR, return recipient details
// ---------------------------------------------------------------------------

export async function decodeQrCode(
  encodedPayload: string,
  requestingUserId: string,
): Promise<DecodedQr> {
  // Decode the base64url payload
  const payload = decodePayloadString(encodedPayload) as QrPayload;

  if (payload.v !== 1) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'Unsupported QR code version.');
  }

  // Look up QR record
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const record = (await db.qrCode.findUnique({
    where: { id: payload.qr_id },
    select: {
      id: true,
      user_id: true,
      payload: true,
      hmac_sig: true,
      is_active: true,
      user: {
        select: {
          username: true,
          display_name: true,
          wallet: { select: { id: true } },
        },
      },
    },
  })) as {
    id: string;
    user_id: string;
    payload: string;
    hmac_sig: string;
    is_active: boolean;
    user: { username: string; display_name: string | null; wallet: { id: string } | null } | null;
  } | null;

  if (!record) throw new AppError(ErrorCode.NOT_FOUND, 'QR code not found or invalid.');

  // Verify HMAC — proves the QR was issued by FlowKey
  if (!verifySignature(record.payload, record.hmac_sig)) {
    logger.warn('QR HMAC verification failed', { qr_id: payload.qr_id });
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'QR code signature is invalid.');
  }

  // Verify the scanned payload matches what we stored
  if (encodedPayload !== record.payload) {
    logger.warn('QR payload mismatch — possible tampering', { qr_id: payload.qr_id });
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'QR code has been tampered with.');
  }

  if (!record.is_active) {
    throw new AppError(
      ErrorCode.CONFLICT,
      'This QR code is no longer active. Ask the recipient to regenerate theirs.',
    );
  }

  // Block self-payment
  if (record.user_id === requestingUserId) {
    throw new AppError(ErrorCode.CONFLICT, 'You cannot pay yourself via QR code.');
  }

  const walletId = record.user?.wallet?.id;
  if (!walletId) throw new AppError(ErrorCode.NOT_FOUND, 'Recipient wallet not found.');

  logger.info('QR code decoded successfully', {
    qr_id: record.id,
    requester: requestingUserId,
  });

  return {
    recipient_wallet_id: walletId,
    display_name: record.user?.display_name ?? record.user?.username ?? 'Unknown',
    username: record.user?.username ?? '',
  };
}

// ---------------------------------------------------------------------------
// Internal helper — create a QR code record
// ---------------------------------------------------------------------------

async function createQrCode(
  userId: string,
  username: string,
  walletId: string,
): Promise<UserQrCode> {
  const qrId = crypto.randomUUID();
  const nonce = crypto.randomBytes(8).toString('hex');

  const payload: QrPayload = {
    v: 1,
    wallet_id: walletId,
    username,
    qr_id: qrId,
    nonce,
  };

  const payloadJson = JSON.stringify(payload);
  const hmacSig = signPayload(payloadJson);
  const encodedPayload = encodePayload(payload);

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const record = (await db.qrCode.create({
    data: {
      id: qrId,
      user_id: userId,
      type: 'static',
      amount: null,
      narration: null,
      payload: encodedPayload,
      hmac_sig: hmacSig,
      expires_at: null,
      is_active: true,
    },
  })) as { id: string; payload: string; is_active: boolean; created_at: Date };

  logger.info('QR code created', { qr_id: qrId, user_id: userId, username });

  return {
    id: record.id,
    payload: record.payload,
    username,
    wallet_id: walletId,
    is_active: record.is_active,
    created_at: record.created_at,
  };
}
