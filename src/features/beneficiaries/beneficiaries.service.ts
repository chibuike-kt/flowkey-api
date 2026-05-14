import { prisma } from '../../common/utils/prisma';
import { AppError, ErrorCode } from '../../common/errors/AppError';
import { logger } from '../../common/utils/logger';
import type { Beneficiary, BeneficiaryListItem, BeneficiaryType } from './beneficiaries.types';
import type {
  AddBeneficiaryInput,
  UpdateBeneficiaryInput,
  ListBeneficiariesInput,
} from './beneficiaries.schema';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

// ---------------------------------------------------------------------------
// POST /beneficiaries
// ---------------------------------------------------------------------------

export async function addBeneficiary(
  userId: string,
  input: AddBeneficiaryInput,
): Promise<Beneficiary> {
  if (input.type === 'internal') {
    // Resolve wallet → user
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const wallet = (await db.wallet.findUnique({
      where: { id: input.recipient_wallet_id },
      select: {
        id: true,
        user: { select: { id: true, username: true, display_name: true } },
      },
    })) as {
      id: string;
      user: { id: string; username: string; display_name: string | null } | null;
    } | null;

    if (!wallet?.user) {
      throw new AppError(ErrorCode.NOT_FOUND, 'Recipient not found.');
    }
    if (wallet.user.id === userId) {
      throw new AppError(ErrorCode.CONFLICT, 'You cannot add yourself as a beneficiary.');
    }

    // Duplicate check
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const existing = (await db.beneficiary.findFirst({
      where: {
        user_id: userId,
        recipient_user_id: wallet.user.id,
        deleted_at: null,
      },
      select: { id: true },
    })) as { id: string } | null;

    if (existing) {
      throw new AppError(ErrorCode.CONFLICT, 'This FlowKey user is already in your beneficiaries.');
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const record = (await db.beneficiary.create({
      data: {
        user_id: userId,
        type: 'internal',
        recipient_user_id: wallet.user.id,
        recipient_name: wallet.user.display_name ?? wallet.user.username,
        nickname: input.nickname ?? null,
        account_verified: true, // FlowKey users are inherently verified
      },
    })) as BeneficiaryRow;

    logger.info('Internal beneficiary added', {
      user_id: userId,
      recipient_user_id: wallet.user.id,
    });

    return toRecord(record);
  } else {
    // Bank beneficiary
    // Duplicate check — same account + bank
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const existing = (await db.beneficiary.findFirst({
      where: {
        user_id: userId,
        account_number: input.account_number,
        bank_code: input.bank_code,
        deleted_at: null,
      },
      select: { id: true },
    })) as { id: string } | null;

    if (existing) {
      throw new AppError(ErrorCode.CONFLICT, 'This bank account is already in your beneficiaries.');
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const record = (await db.beneficiary.create({
      data: {
        user_id: userId,
        type: 'bank',
        bank_code: input.bank_code,
        bank_name: input.bank_name,
        account_number: input.account_number,
        account_name: input.account_name,
        nickname: input.nickname ?? null,
        account_verified: true,
        account_verified_at: new Date(),
      },
    })) as BeneficiaryRow;

    logger.info('Bank beneficiary added', {
      user_id: userId,
      bank_code: input.bank_code,
      account_last4: input.account_number.slice(-4),
    });

    return toRecord(record);
  }
}

// ---------------------------------------------------------------------------
// GET /beneficiaries
// ---------------------------------------------------------------------------

export async function listBeneficiaries(
  userId: string,
  input: ListBeneficiariesInput,
): Promise<{ items: BeneficiaryListItem[]; next_cursor: string | null }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: Record<string, any> = {
    user_id: userId,
    deleted_at: null,
  };

  if (input.type !== 'all') where['type'] = input.type;

  if (input.search) {
    const s = input.search.trim();
    where['OR'] = [
      { nickname: { contains: s, mode: 'insensitive' } },
      { account_name: { contains: s, mode: 'insensitive' } },
      { recipient_name: { contains: s, mode: 'insensitive' } },
      { bank_name: { contains: s, mode: 'insensitive' } },
    ];
  }

  if (input.cursor) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const pivot = (await db.beneficiary.findUnique({
      where: { id: input.cursor },
      select: { created_at: true },
    })) as { created_at: Date } | null;
    if (pivot) where['created_at'] = { lt: pivot.created_at };
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const rows = (await db.beneficiary.findMany({
    where,
    orderBy: { created_at: 'desc' },
    take: input.limit + 1,
    select: {
      id: true,
      type: true,
      nickname: true,
      recipient_user_id: true,
      recipient_name: true,
      bank_code: true,
      bank_name: true,
      account_number: true,
      account_name: true,
      account_verified: true,
      created_at: true,
    },
  })) as BeneficiaryRow[];

  const items = rows.slice(0, input.limit).map(toListItem);
  const nextCursor = rows.length > input.limit ? (items[items.length - 1]?.id ?? null) : null;

  return { items, next_cursor: nextCursor };
}

// ---------------------------------------------------------------------------
// GET /beneficiaries/:id
// ---------------------------------------------------------------------------

export async function getBeneficiary(beneficiaryId: string, userId: string): Promise<Beneficiary> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const record = (await db.beneficiary.findFirst({
    where: { id: beneficiaryId, user_id: userId, deleted_at: null },
  })) as BeneficiaryRow | null;

  if (!record) throw new AppError(ErrorCode.NOT_FOUND, 'Beneficiary not found.');

  return toRecord(record);
}

// ---------------------------------------------------------------------------
// PATCH /beneficiaries/:id
// ---------------------------------------------------------------------------

export async function updateBeneficiary(
  beneficiaryId: string,
  userId: string,
  input: UpdateBeneficiaryInput,
): Promise<Beneficiary> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const existing = (await db.beneficiary.findFirst({
    where: { id: beneficiaryId, user_id: userId, deleted_at: null },
    select: { id: true },
  })) as { id: string } | null;

  if (!existing) throw new AppError(ErrorCode.NOT_FOUND, 'Beneficiary not found.');

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const updated = (await db.beneficiary.update({
    where: { id: beneficiaryId },
    data: { nickname: input.nickname },
  })) as BeneficiaryRow;

  logger.info('Beneficiary updated', { beneficiary_id: beneficiaryId, user_id: userId });

  return toRecord(updated);
}

// ---------------------------------------------------------------------------
// DELETE /beneficiaries/:id
// ---------------------------------------------------------------------------

export async function deleteBeneficiary(beneficiaryId: string, userId: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const existing = (await db.beneficiary.findFirst({
    where: { id: beneficiaryId, user_id: userId, deleted_at: null },
    select: { id: true },
  })) as { id: string } | null;

  if (!existing) throw new AppError(ErrorCode.NOT_FOUND, 'Beneficiary not found.');

  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  await db.beneficiary.update({
    where: { id: beneficiaryId },
    data: { deleted_at: new Date() },
  });

  logger.info('Beneficiary deleted', { beneficiary_id: beneficiaryId, user_id: userId });
}

// ---------------------------------------------------------------------------
// Internal types + mappers
// ---------------------------------------------------------------------------

interface BeneficiaryRow {
  id: string;
  user_id: string;
  type: string;
  nickname: string | null;
  recipient_user_id: string | null;
  recipient_name: string | null;
  bank_code: string | null;
  bank_name: string | null;
  account_number: string | null;
  account_name: string | null;
  account_verified: boolean;
  account_verified_at: Date | null;
  created_at: Date;
  updated_at?: Date;
}

function maskAccountNumber(acct: string | null): string | null {
  if (!acct || acct.length < 4) return acct;
  return `****${acct.slice(-4)}`;
}

function toRecord(r: BeneficiaryRow): Beneficiary {
  return {
    id: r.id,
    user_id: r.user_id,
    type: r.type as BeneficiaryType,
    nickname: r.nickname,
    recipient_user_id: r.recipient_user_id,
    recipient_name: r.recipient_name,
    bank_code: r.bank_code,
    bank_name: r.bank_name,
    account_number: r.account_number, // full number in detail view
    account_name: r.account_name,
    account_verified: r.account_verified,
    account_verified_at: r.account_verified_at,
    created_at: r.created_at,
    updated_at: r.updated_at ?? r.created_at,
  };
}

function toListItem(r: BeneficiaryRow): BeneficiaryListItem {
  const displayName =
    r.nickname ?? (r.type === 'internal' ? r.recipient_name : r.account_name) ?? 'Unknown';

  const displaySub =
    r.type === 'internal'
      ? (r.recipient_name ?? '')
      : `${r.bank_name ?? ''} ${maskAccountNumber(r.account_number) ?? ''}`.trim();

  return {
    id: r.id,
    type: r.type as BeneficiaryType,
    nickname: r.nickname,
    display_name: displayName,
    display_sub: displaySub,
    recipient_user_id: r.recipient_user_id,
    bank_code: r.bank_code,
    bank_name: r.bank_name,
    account_number: maskAccountNumber(r.account_number),
    account_name: r.account_name,
    account_verified: r.account_verified,
    created_at: r.created_at,
  };
}
