/**
 * FlowKey — Application Error System
 *
 * All errors thrown by service layer code must be AppError instances.
 * The error handler middleware in src/common/middleware/errorHandler.ts
 * converts AppErrors into the standard response envelope.
 *
 * Internal error codes are defined as an enum here and are the ONLY codes
 * exposed to the client. Raw database errors, stack traces, and provider
 * error messages are NEVER forwarded to the client.
 */

// ---------------------------------------------------------------------------
// Internal error code registry
// ---------------------------------------------------------------------------

export enum ErrorCode {
  // --- Generic ---
  INTERNAL_SERVER_ERROR = 'INTERNAL_SERVER_ERROR',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  NOT_FOUND = 'NOT_FOUND',
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  RATE_LIMITED = 'RATE_LIMITED',
  CONFLICT = 'CONFLICT',
  IDEMPOTENCY_KEY_MISMATCH = 'IDEMPOTENCY_KEY_MISMATCH',

  // --- Auth ---
  INVALID_CREDENTIALS = 'INVALID_CREDENTIALS',
  INVALID_TOKEN = 'INVALID_TOKEN',
  TOKEN_EXPIRED = 'TOKEN_EXPIRED',
  SESSION_NOT_FOUND = 'SESSION_NOT_FOUND',
  SESSION_REVOKED = 'SESSION_REVOKED',
  DEVICE_LIMIT_EXCEEDED = 'DEVICE_LIMIT_EXCEEDED',
  ACCOUNT_LOCKED = 'ACCOUNT_LOCKED',
  ACCOUNT_FROZEN = 'ACCOUNT_FROZEN',
  PASSCODE_LOCKED = 'PASSCODE_LOCKED',
  TRANSACTION_PIN_LOCKED = 'TRANSACTION_PIN_LOCKED',

  // --- Registration / OTP ---
  PHONE_ALREADY_REGISTERED = 'PHONE_ALREADY_REGISTERED',
  EMAIL_ALREADY_REGISTERED = 'EMAIL_ALREADY_REGISTERED',
  OTP_INVALID = 'OTP_INVALID',
  OTP_EXPIRED = 'OTP_EXPIRED',
  OTP_MAX_ATTEMPTS_EXCEEDED = 'OTP_MAX_ATTEMPTS_EXCEEDED',
  OTP_RESEND_LIMIT_EXCEEDED = 'OTP_RESEND_LIMIT_EXCEEDED',

  // --- Wallet & Transactions ---
  INSUFFICIENT_BALANCE = 'INSUFFICIENT_BALANCE',
  TRANSACTION_LIMIT_EXCEEDED = 'TRANSACTION_LIMIT_EXCEEDED',
  DAILY_LIMIT_EXCEEDED = 'DAILY_LIMIT_EXCEEDED',
  TRANSACTION_NOT_FOUND = 'TRANSACTION_NOT_FOUND',
  TRANSACTION_NOT_REVERSIBLE = 'TRANSACTION_NOT_REVERSIBLE',
  RECIPIENT_NOT_FOUND = 'RECIPIENT_NOT_FOUND',
  SELF_TRANSFER_NOT_ALLOWED = 'SELF_TRANSFER_NOT_ALLOWED',
  INVALID_AMOUNT = 'INVALID_AMOUNT',

  // --- KYC ---
  KYC_VERIFICATION_FAILED = 'KYC_VERIFICATION_FAILED',
  KYC_PROVIDER_UNAVAILABLE = 'KYC_PROVIDER_UNAVAILABLE',
  KYC_COOLDOWN_ACTIVE = 'KYC_COOLDOWN_ACTIVE',
  KYC_TIER_INSUFFICIENT = 'KYC_TIER_INSUFFICIENT',
  KYC_TIER_SEQUENCE_VIOLATION = 'KYC_TIER_SEQUENCE_VIOLATION',

  // --- Webhooks ---
  WEBHOOK_SIGNATURE_INVALID = 'WEBHOOK_SIGNATURE_INVALID',

  // --- Disputes ---
  DISPUTE_ALREADY_EXISTS = 'DISPUTE_ALREADY_EXISTS',
  DISPUTE_NOT_FOUND = 'DISPUTE_NOT_FOUND',

  // --- Bot ---
  BOT_SESSION_EXPIRED = 'BOT_SESSION_EXPIRED',
  BOT_INTENT_LIMIT_EXCEEDED = 'BOT_INTENT_LIMIT_EXCEEDED',
  BOT_AMBIGUOUS_INTENT = 'BOT_AMBIGUOUS_INTENT',
}

// ---------------------------------------------------------------------------
// HTTP status map
// ---------------------------------------------------------------------------

const HTTP_STATUS_MAP: Record<ErrorCode, number> = {
  [ErrorCode.INTERNAL_SERVER_ERROR]: 500,
  [ErrorCode.VALIDATION_ERROR]: 422,
  [ErrorCode.NOT_FOUND]: 404,
  [ErrorCode.UNAUTHORIZED]: 401,
  [ErrorCode.FORBIDDEN]: 403,
  [ErrorCode.RATE_LIMITED]: 429,
  [ErrorCode.CONFLICT]: 409,
  [ErrorCode.IDEMPOTENCY_KEY_MISMATCH]: 422,

  [ErrorCode.INVALID_CREDENTIALS]: 401,
  [ErrorCode.INVALID_TOKEN]: 401,
  [ErrorCode.TOKEN_EXPIRED]: 401,
  [ErrorCode.SESSION_NOT_FOUND]: 401,
  [ErrorCode.SESSION_REVOKED]: 401,
  [ErrorCode.DEVICE_LIMIT_EXCEEDED]: 403,
  [ErrorCode.ACCOUNT_LOCKED]: 403,
  [ErrorCode.ACCOUNT_FROZEN]: 403,
  [ErrorCode.PASSCODE_LOCKED]: 403,
  [ErrorCode.TRANSACTION_PIN_LOCKED]: 403,

  [ErrorCode.PHONE_ALREADY_REGISTERED]: 409,
  [ErrorCode.EMAIL_ALREADY_REGISTERED]: 409,
  [ErrorCode.OTP_INVALID]: 422,
  [ErrorCode.OTP_EXPIRED]: 422,
  [ErrorCode.OTP_MAX_ATTEMPTS_EXCEEDED]: 429,
  [ErrorCode.OTP_RESEND_LIMIT_EXCEEDED]: 429,

  [ErrorCode.INSUFFICIENT_BALANCE]: 422,
  [ErrorCode.TRANSACTION_LIMIT_EXCEEDED]: 422,
  [ErrorCode.DAILY_LIMIT_EXCEEDED]: 422,
  [ErrorCode.TRANSACTION_NOT_FOUND]: 404,
  [ErrorCode.TRANSACTION_NOT_REVERSIBLE]: 422,
  [ErrorCode.RECIPIENT_NOT_FOUND]: 404,
  [ErrorCode.SELF_TRANSFER_NOT_ALLOWED]: 422,
  [ErrorCode.INVALID_AMOUNT]: 422,

  [ErrorCode.KYC_VERIFICATION_FAILED]: 422,
  [ErrorCode.KYC_PROVIDER_UNAVAILABLE]: 503,
  [ErrorCode.KYC_COOLDOWN_ACTIVE]: 429,
  [ErrorCode.KYC_TIER_INSUFFICIENT]: 403,
  [ErrorCode.KYC_TIER_SEQUENCE_VIOLATION]: 422,

  [ErrorCode.WEBHOOK_SIGNATURE_INVALID]: 401,

  [ErrorCode.DISPUTE_ALREADY_EXISTS]: 409,
  [ErrorCode.DISPUTE_NOT_FOUND]: 404,

  [ErrorCode.BOT_SESSION_EXPIRED]: 422,
  [ErrorCode.BOT_INTENT_LIMIT_EXCEEDED]: 429,
  [ErrorCode.BOT_AMBIGUOUS_INTENT]: 422,
};

// ---------------------------------------------------------------------------
// AppError class
// ---------------------------------------------------------------------------

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly httpStatus: number;
  public readonly isOperational: boolean;

  /**
   * @param code      - Internal error code from ErrorCode enum
   * @param message   - Safe, client-facing message. Never include internal details.
   * @param isOperational - true = expected business error; false = programming error
   */
  constructor(code: ErrorCode, message: string, isOperational = true) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.httpStatus = HTTP_STATUS_MAP[code] ?? 500;
    this.isOperational = isOperational;

    // Maintain proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, AppError.prototype);

    // Capture stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AppError);
    }
  }

  /**
   * Returns true if the error is a known operational error (not a bug).
   */
  static isAppError(error: unknown): error is AppError {
    return error instanceof AppError;
  }
}
