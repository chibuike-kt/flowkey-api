/**
 * FlowKey — Payment Requests Service
 */

import { prisma } from '../../common/utils/prisma';
import { AppError, ErrorCode } from '../../common/errors/AppError';
import { logger } from '../../common/utils/logger';
import { executeInternalTransfer } from '../transfers/transfers.service';
import type {
  PaymentRequest,
  PaymentRequestListItem,
  PaymentRequestStatus,
} from './payment-requests.types';
import type {
  CreatePaymentRequestInput,
  PayPaymentRequestInput,
  ListPaymentRequestsInput,
} from './payment-requests.schema';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

// ---------------------------------------------------------------------------
// Resolve receiver from identifier (username, universal_id, or wallet_id)
// ---------------------------------------------------------------------------

async function resolveReceiver(identifier: string): Promise<{
  userId: string;
  walletId: string;
  displayName: string;
  username: string;
}> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let where: Record<string, any>;

  // UUID → treat as wallet_id
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identifier)) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const wallet = (await db.wallet.findUnique({
      where: { id: identifier },
      select: { id: true, user: { select: { id: true, username: true, display_name: true } } },
    })) as {
      id: string;
      user: { id: string; username: string; display_name: string | null } | null;
    } | null;

    if (!wallet?.user) throw new AppError(ErrorCode.NOT_FOUND, 'Recipient not found.');
    return {
      userId: wallet.user.id,
      walletId: wallet.id,
      displayName: wallet.user.display_name ?? wallet.user.username,
      username: wallet.user.username,
    };
  }

  // WORD-WORD-WORD → Universal ID
  if (/^[A-Z]+-[A-Z]+-[A-Z]+$/.test(identifier.toUpperCase())) {
    where = { universal_id: identifier.toUpperCase() };
  } else {
    where = { username: identifier.toLowerCase() };
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const user = (await db.user.findFirst({
    where,
    select: {
      id: true,
      username: true,
      display_name: true,
      wallet: { select: { id: true } },
    },
  })) as {
    id: string;
    username: string;
    display_name: string | null;
    wallet: { id: string } | null;
  } | null;

  if (!user?.wallet) throw new AppError(ErrorCode.NOT_FOUND, 'Recipient not found.');
  return {
    userId: user.id,
    walletId: user.wallet.id,
    displayName: user.display_name ?? user.username,
    username: user.username,
  };
}

// ---------------------------------------------------------------------------
// POST /payment-requests — create
// ---------------------------------------------------------------------------

export async function createPaymentRequest(
  senderId: string,
  input: CreatePaymentRequestInput,
): Promise<PaymentRequest> {
  const receiver = await resolveReceiver(input.receiver_identifier);

  if (receiver.userId === senderId) {
    throw new AppError(ErrorCode.CONFLICT, 'You cannot request payment from yourself.');
  }

  const expiresInHours = input.expires_in_hours ?? 24;
  const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000);

  // Load sender info for response
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const sender = (await db.user.findUnique({
    where: { id: senderId },
    select: { username: true, display_name: true },
  })) as { username: string; display_name: string | null } | null;

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const record = (await db.paymentRequest.create({
    data: {
      sender_id: senderId,
      receiver_id: receiver.userId,
      amount: BigInt(input.amount_kobo),
      narration: input.narration ?? null,
      status: 'pending',
      expires_at: expiresAt,
    },
  })) as PaymentRequestRow;

  logger.info('Payment request created', {
    id: record.id,
    sender_id: senderId,
    receiver_id: receiver.userId,
    amount_kobo: input.amount_kobo,
    expires_at: expiresAt,
  });

  return toRecord(record, {
    senderName: sender?.display_name ?? sender?.username ?? null,
    senderUsername: sender?.username ?? null,
    receiverName: receiver.displayName,
    receiverUsername: receiver.username,
  });
}

// ---------------------------------------------------------------------------
// GET /payment-requests — list
// ---------------------------------------------------------------------------

export async function listPaymentRequests(
  userId: string,
  input: ListPaymentRequestsInput,
): Promise<{ items: PaymentRequestListItem[]; next_cursor: string | null }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: Record<string, any> = { deleted_at: null };

  if (input.direction === 'sent') where['sender_id'] = userId;
  else if (input.direction === 'received') where['receiver_id'] = userId;
  else where['OR'] = [{ sender_id: userId }, { receiver_id: userId }];

  if (input.status) where['status'] = input.status;

  if (input.cursor) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const pivot = (await db.paymentRequest.findUnique({
      where: { id: input.cursor },
      select: { created_at: true },
    })) as { created_at: Date } | null;
    if (pivot) where['created_at'] = { lt: pivot.created_at };
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const rows = (await db.paymentRequest.findMany({
    where,
    orderBy: { created_at: 'desc' },
    take: input.limit + 1,
    include: {
      sender: { select: { username: true, display_name: true } },
      receiver: { select: { username: true, display_name: true } },
    },
  })) as PaymentRequestRowWithUsers[];

  const items = rows.slice(0, input.limit).map((r) => toListItem(r, userId));
  const nextCursor = rows.length > input.limit ? (items[items.length - 1]?.id ?? null) : null;

  return { items, next_cursor: nextCursor };
}

// ---------------------------------------------------------------------------
// GET /payment-requests/:id — detail
// ---------------------------------------------------------------------------

export async function getPaymentRequest(id: string, userId: string): Promise<PaymentRequest> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const row = (await db.paymentRequest.findFirst({
    where: {
      id,
      deleted_at: null,
      OR: [{ sender_id: userId }, { receiver_id: userId }],
    },
    include: {
      sender: { select: { username: true, display_name: true } },
      receiver: { select: { username: true, display_name: true } },
    },
  })) as PaymentRequestRowWithUsers | null;

  if (!row) throw new AppError(ErrorCode.NOT_FOUND, 'Payment request not found.');

  return toRecord(row, {
    senderName: row.sender?.display_name ?? row.sender?.username ?? null,
    senderUsername: row.sender?.username ?? null,
    receiverName: row.receiver?.display_name ?? row.receiver?.username ?? null,
    receiverUsername: row.receiver?.username ?? null,
  });
}

// ---------------------------------------------------------------------------
// POST /payment-requests/:id/pay — receiver pays
// ---------------------------------------------------------------------------

export async function payPaymentRequest(
  id: string,
  receiverId: string,
  input: PayPaymentRequestInput,
  idempotencyKey: string,
): Promise<{ transaction_id: string }> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const req = (await db.paymentRequest.findFirst({
    where: { id, deleted_at: null },
    select: {
      id: true,
      sender_id: true,
      receiver_id: true,
      amount: true,
      narration: true,
      status: true,
      expires_at: true,
    },
  })) as {
    id: string;
    sender_id: string;
    receiver_id: string;
    amount: bigint;
    narration: string | null;
    status: string;
    expires_at: Date;
  } | null;

  if (!req) throw new AppError(ErrorCode.NOT_FOUND, 'Payment request not found.');
  if (req.receiver_id !== receiverId)
    throw new AppError(ErrorCode.FORBIDDEN, 'Only the recipient can pay this request.');
  if (req.status !== 'pending')
    throw new AppError(ErrorCode.CONFLICT, `This request has already been ${req.status}.`);
  if (req.expires_at < new Date())
    throw new AppError(ErrorCode.CONFLICT, 'This payment request has expired.');

  // Load receiver wallet for the transfer
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const receiverWallet = (await db.wallet.findUnique({
    where: { user_id: receiverId },
    select: { id: true },
  })) as { id: string } | null;

  if (!receiverWallet) throw new AppError(ErrorCode.NOT_FOUND, 'Wallet not found.');

  // Load sender wallet as the recipient of the transfer
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const senderWallet = (await db.wallet.findUnique({
    where: { user_id: req.sender_id },
    select: { id: true },
  })) as { id: string } | null;

  if (!senderWallet) throw new AppError(ErrorCode.NOT_FOUND, 'Recipient wallet not found.');

  // Execute transfer — receiver sends to sender (paying the request)
  const result = await executeInternalTransfer(
    receiverId,
    {
      recipient_wallet_id: senderWallet.id,
      amount_kobo: Number(req.amount),
      narration: req.narration ?? `Payment request #${req.id.slice(0, 8)}`,
      pin: input.pin,
      source: 'api',
    },
    idempotencyKey,
  );

  // Mark request as paid
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  await db.paymentRequest.update({
    where: { id },
    data: { status: 'paid', paid_at: new Date() },
  });

  logger.info('Payment request paid', {
    request_id: id,
    receiver_id: receiverId,
    sender_id: req.sender_id,
    amount_kobo: req.amount.toString(),
    transaction_id: result.transaction_id,
  });

  return { transaction_id: result.transaction_id };
}

// ---------------------------------------------------------------------------
// POST /payment-requests/:id/decline — receiver declines
// ---------------------------------------------------------------------------

export async function declinePaymentRequest(id: string, receiverId: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const req = (await db.paymentRequest.findFirst({
    where: { id, deleted_at: null },
    select: { id: true, receiver_id: true, status: true },
  })) as { id: string; receiver_id: string; status: string } | null;

  if (!req) throw new AppError(ErrorCode.NOT_FOUND, 'Payment request not found.');
  if (req.receiver_id !== receiverId)
    throw new AppError(ErrorCode.FORBIDDEN, 'Only the recipient can decline this request.');
  if (req.status !== 'pending')
    throw new AppError(ErrorCode.CONFLICT, `This request has already been ${req.status}.`);

  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  await db.paymentRequest.update({
    where: { id },
    data: { status: 'declined' },
  });

  logger.info('Payment request declined', { request_id: id, receiver_id: receiverId });
}

// ---------------------------------------------------------------------------
// POST /payment-requests/:id/cancel — sender cancels
// ---------------------------------------------------------------------------

export async function cancelPaymentRequest(id: string, senderId: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const req = (await db.paymentRequest.findFirst({
    where: { id, deleted_at: null },
    select: { id: true, sender_id: true, status: true },
  })) as { id: string; sender_id: string; status: string } | null;

  if (!req) throw new AppError(ErrorCode.NOT_FOUND, 'Payment request not found.');
  if (req.sender_id !== senderId)
    throw new AppError(ErrorCode.FORBIDDEN, 'Only the sender can cancel this request.');
  if (req.status !== 'pending')
    throw new AppError(ErrorCode.CONFLICT, `This request has already been ${req.status}.`);

  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  await db.paymentRequest.update({
    where: { id },
    data: { status: 'cancelled' },
  });

  logger.info('Payment request cancelled', { request_id: id, sender_id: senderId });
}

// ---------------------------------------------------------------------------
// Internal row types + mappers
// ---------------------------------------------------------------------------

interface PaymentRequestRow {
  id: string;
  sender_id: string;
  receiver_id: string;
  amount: bigint;
  narration: string | null;
  status: string;
  expires_at: Date;
  paid_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

interface PaymentRequestRowWithUsers extends PaymentRequestRow {
  sender: { username: string; display_name: string | null } | null;
  receiver: { username: string; display_name: string | null } | null;
}

function toRecord(
  r: PaymentRequestRow,
  names: {
    senderName: string | null;
    senderUsername: string | null;
    receiverName: string | null;
    receiverUsername: string | null;
  },
): PaymentRequest {
  return {
    id: r.id,
    sender_id: r.sender_id,
    receiver_id: r.receiver_id,
    amount_kobo: r.amount.toString(),
    narration: r.narration,
    status: r.status as PaymentRequestStatus,
    expires_at: r.expires_at,
    paid_at: r.paid_at,
    created_at: r.created_at,
    updated_at: r.updated_at,
    sender_name: names.senderName,
    sender_username: names.senderUsername,
    receiver_name: names.receiverName,
    receiver_username: names.receiverUsername,
  };
}

function toListItem(r: PaymentRequestRowWithUsers, userId: string): PaymentRequestListItem {
  const isSender = r.sender_id === userId;
  const counterpart = isSender ? r.receiver : r.sender;
  const name = counterpart?.display_name ?? counterpart?.username ?? 'Unknown';
  const username = counterpart?.username ?? '';

  return {
    id: r.id,
    direction: isSender ? 'sent' : 'received',
    amount_kobo: r.amount.toString(),
    narration: r.narration,
    status: r.status as PaymentRequestStatus,
    expires_at: r.expires_at,
    paid_at: r.paid_at,
    created_at: r.created_at,
    counterpart_name: name,
    counterpart_username: username,
  };
}
