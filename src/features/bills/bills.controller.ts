import type { Request, Response, NextFunction } from 'express';
import { AppError, ErrorCode } from '../../common/errors/AppError';
import {
  BuyAirtimeSchema,
  GetDataPlansSchema,
  BuyDataSchema,
  GetTvPlansSchema,
  VerifySmartcardSchema,
  PayTvSchema,
  VerifyMeterSchema,
  PayElectricitySchema,
  PayEducationSchema,
  ListBillsSchema,
} from './bills.schema';
import {
  buyAirtime,
  getDataPlans,
  buyData,
  getTvPlans,
  verifySmartcard,
  payTv,
  verifyMeter,
  payElectricity,
  payEducation,
  listBills,
  getBill,
  requeryBill,
} from './bills.service';
import { DISCO_LIST } from './bills.types';

function uid(req: Request): string {
  return req.user!.sub as string;
}

function validate<T>(
  schema: {
    safeParse: (d: unknown) => {
      success: boolean;
      data?: T;
      error?: { issues: { message: string }[] };
    };
  },
  data: unknown,
): T {
  const r = schema.safeParse(data);
  if (!r.success)
    throw new AppError(
      ErrorCode.VALIDATION_ERROR,
      r.error!.issues.map((e) => e.message).join('; '),
    );
  return r.data!;
}

// ---------------------------------------------------------------------------
// Airtime
// ---------------------------------------------------------------------------

export async function handleBuyAirtime(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const input = validate(BuyAirtimeSchema, req.body);
    const result = await buyAirtime(uid(req), input);
    res.status(201).json({ success: true, data: result, meta: null, error: null });
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

export async function handleGetDataPlans(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { network } = validate(GetDataPlansSchema, req.query);
    const plans = await getDataPlans(network);
    res.json({ success: true, data: plans, meta: null, error: null });
  } catch (err) {
    next(err);
  }
}

export async function handleBuyData(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const input = validate(BuyDataSchema, req.body);
    const result = await buyData(uid(req), input);
    res.status(201).json({ success: true, data: result, meta: null, error: null });
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// TV
// ---------------------------------------------------------------------------

export async function handleGetTvPlans(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { provider } = validate(GetTvPlansSchema, req.query);
    const plans = await getTvPlans(provider);
    res.json({ success: true, data: plans, meta: null, error: null });
  } catch (err) {
    next(err);
  }
}

export async function handleVerifySmartcard(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const input = validate(VerifySmartcardSchema, req.body);
    const result = await verifySmartcard(input);
    res.json({ success: true, data: result, meta: null, error: null });
  } catch (err) {
    next(err);
  }
}

export async function handlePayTv(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const input = validate(PayTvSchema, req.body);
    const result = await payTv(uid(req), input);
    res.status(201).json({ success: true, data: result, meta: null, error: null });
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// Electricity
// ---------------------------------------------------------------------------

export async function handleGetDiscos(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    res.json({ success: true, data: DISCO_LIST, meta: null, error: null });
  } catch (err) {
    next(err);
  }
}

export async function handleVerifyMeter(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const input = validate(VerifyMeterSchema, req.body);
    const result = await verifyMeter(input);
    res.json({ success: true, data: result, meta: null, error: null });
  } catch (err) {
    next(err);
  }
}

export async function handlePayElectricity(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const input = validate(PayElectricitySchema, req.body);
    const result = await payElectricity(uid(req), input);
    res.status(201).json({ success: true, data: result, meta: null, error: null });
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// Education
// ---------------------------------------------------------------------------

export async function handlePayEducation(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const input = validate(PayEducationSchema, req.body);
    const result = await payEducation(uid(req), input);
    res.status(201).json({ success: true, data: result, meta: null, error: null });
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// History + requery
// ---------------------------------------------------------------------------

export async function handleListBills(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const input = validate(ListBillsSchema, req.query);
    const { items, next_cursor } = await listBills(uid(req), input);
    res.json({
      success: true,
      data: items,
      meta: { next_cursor, limit: input.limit },
      error: null,
    });
  } catch (err) {
    next(err);
  }
}

export async function handleGetBill(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await getBill(req.params['id'] as string, uid(req));
    res.json({ success: true, data: result, meta: null, error: null });
  } catch (err) {
    next(err);
  }
}

export async function handleRequeryBill(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await requeryBill(req.params['id'] as string, uid(req));
    res.json({ success: true, data: result, meta: null, error: null });
  } catch (err) {
    next(err);
  }
}
