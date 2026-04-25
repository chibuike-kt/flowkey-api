/**
 * FlowKey — Standard API Response Types
 *
 * Every endpoint returns this envelope. No exceptions.
 * The error handler middleware enforces this on all error paths.
 */

export interface ApiMeta {
  cursor?: string | null;
  has_more?: boolean;
  total?: number;
}

export interface ApiSuccess<T = unknown> {
  success: true;
  data: T;
  meta: ApiMeta | null;
  error: null;
}

export interface ApiError {
  success: false;
  data: null;
  meta: null;
  error: {
    code: string;
    message: string;
  };
}

export type ApiResponse<T = unknown> = ApiSuccess<T> | ApiError;

// ---------------------------------------------------------------------------
// Response builder helpers
// ---------------------------------------------------------------------------

export function successResponse<T>(data: T, meta: ApiMeta | null = null): ApiSuccess<T> {
  return {
    success: true,
    data,
    meta,
    error: null,
  };
}

export function errorResponse(code: string, message: string): ApiError {
  return {
    success: false,
    data: null,
    meta: null,
    error: { code, message },
  };
}
