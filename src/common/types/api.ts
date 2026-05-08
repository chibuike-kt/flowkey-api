export interface ApiSuccess<T = unknown> {
  success: true;
  data: T;
  meta: Record<string, unknown> | null;
  error: null;
}

export interface ApiError {
  success: false;
  data: null;
  meta: null;
  error: { code: string; message: string };
}

export type ApiResponse<T = unknown> = ApiSuccess<T> | ApiError;

export function successResponse<T>(
  data: T,
  meta: Record<string, unknown> | null = null,
): ApiSuccess<T> {
  return { success: true, data, meta, error: null };
}

export function errorResponse(code: string, message: string): ApiError {
  return { success: false, data: null, meta: null, error: { code, message } };
}
