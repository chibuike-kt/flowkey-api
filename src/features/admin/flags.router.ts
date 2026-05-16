import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import {
  getAllFlags,
  setFlag,
  resetFlag,
  type FeatureFlag,
} from '../../common/feature-flags/index';
import { AppError, ErrorCode } from '../../common/errors/AppError';

const router = Router();

// ---------------------------------------------------------------------------
// Admin key guard — simple shared secret
// Set ADMIN_API_KEY in environment. Keep it long and random.
// ---------------------------------------------------------------------------

function requireAdminKey(req: Request, _res: Response, next: NextFunction): void {
  const adminKey = process.env['ADMIN_API_KEY'];

  if (!adminKey) {
    // No key configured — block all access to be safe
    next(new AppError(ErrorCode.FORBIDDEN, 'Admin access not configured.'));
    return;
  }

  const provided = req.headers['x-admin-key'] as string | undefined;

  if (!provided || provided !== adminKey) {
    next(new AppError(ErrorCode.FORBIDDEN, 'Invalid admin key.'));
    return;
  }

  next();
}

router.use(requireAdminKey);

// GET /admin/flags
router.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const flags = await getAllFlags();
    res.json({ success: true, data: flags, meta: null, error: null });
  } catch (err) {
    next(err);
  }
});

// PUT /admin/flags/:flag
router.put('/:flag', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const flag = req.params['flag'] as FeatureFlag;
    const body = req.body as { enabled?: boolean };

    if (typeof body.enabled !== 'boolean') {
      throw new AppError(ErrorCode.VALIDATION_ERROR, '`enabled` must be a boolean.');
    }

    await setFlag(flag, body.enabled);
    res.json({
      success: true,
      data: { flag, enabled: body.enabled },
      meta: null,
      error: null,
    });
  } catch (err) {
    next(err);
  }
});

// DELETE /admin/flags/:flag  — reset to default
router.delete('/:flag', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const flag = req.params['flag'] as FeatureFlag;
    await resetFlag(flag);
    res.json({ success: true, data: { flag, reset: true }, meta: null, error: null });
  } catch (err) {
    next(err);
  }
});

export { router as flagsRouter };
