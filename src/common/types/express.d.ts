/**
 * FlowKey — Express Request Type Augmentation
 *
 * Extends the Express Request object with the authenticated user payload.
 * `req.user` is set by the auth middleware on all protected routes.
 * It is undefined on public routes — controllers must not access it there.
 */

import type { AccessTokenPayload } from '../../features/auth/auth.types';

declare global {
  namespace Express {
    interface Request {
      /**
       * Set by requireAuth middleware after JWT verification.
       * Undefined on public routes.
       */
      user?: AccessTokenPayload;
    }
  }
}

export {};
