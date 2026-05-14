import type { Request, Response, NextFunction } from 'express';
import { AppError, ErrorCode } from '../../common/errors/AppError';
import {
  AddBeneficiarySchema,
  UpdateBeneficiarySchema,
  ListBeneficiariesSchema,
} from './beneficiaries.schema';
import {
  addBeneficiary,
  listBeneficiaries,
  getBeneficiary,
  updateBeneficiary,
  deleteBeneficiary,
} from './beneficiaries.service';

function userId(req: Request): string {
  return req.user!.sub as string;
}

// POST /beneficiaries
export async function handleAddBeneficiary(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const parsed = AddBeneficiarySchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        parsed.error.issues.map((e: { message: string }) => e.message).join('; '),
      );
    }
    const result = await addBeneficiary(userId(req), parsed.data);
    res.status(201).json({ success: true, data: result, meta: null, error: null });
  } catch (err) {
    next(err);
  }
}

// GET /beneficiaries
export async function handleListBeneficiaries(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const parsed = ListBeneficiariesSchema.safeParse(req.query);
    if (!parsed.success) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        parsed.error.issues.map((e: { message: string }) => e.message).join('; '),
      );
    }
    const { items, next_cursor } = await listBeneficiaries(userId(req), parsed.data);
    res.json({
      success: true,
      data: items,
      meta: { next_cursor, limit: parsed.data.limit },
      error: null,
    });
  } catch (err) {
    next(err);
  }
}

// GET /beneficiaries/:id
export async function handleGetBeneficiary(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const id = req.params['id'] as string;
    if (!id) throw new AppError(ErrorCode.VALIDATION_ERROR, 'Beneficiary ID required.');
    const result = await getBeneficiary(id, userId(req));
    res.json({ success: true, data: result, meta: null, error: null });
  } catch (err) {
    next(err);
  }
}

// PATCH /beneficiaries/:id
export async function handleUpdateBeneficiary(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const id = req.params['id'] as string;
    if (!id) throw new AppError(ErrorCode.VALIDATION_ERROR, 'Beneficiary ID required.');
    const parsed = UpdateBeneficiarySchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        parsed.error.issues.map((e: { message: string }) => e.message).join('; '),
      );
    }
    const result = await updateBeneficiary(id, userId(req), parsed.data);
    res.json({ success: true, data: result, meta: null, error: null });
  } catch (err) {
    next(err);
  }
}

// DELETE /beneficiaries/:id
export async function handleDeleteBeneficiary(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const id = req.params['id'] as string;
    if (!id) throw new AppError(ErrorCode.VALIDATION_ERROR, 'Beneficiary ID required.');
    await deleteBeneficiary(id, userId(req));
    res.json({ success: true, data: { deleted: true }, meta: null, error: null });
  } catch (err) {
    next(err);
  }
}
