import type { Request, Response, NextFunction } from 'express';
import {
  InitiateRegistrationSchema,
  VerifyOtpSchema,
  CheckUsernameSchema,
  CompleteRegistrationSchema,
  ResendOtpSchema,
  LoginSchema,
  RefreshTokenSchema,
  LogoutSchema,
  ChangePasscodeSchema,
  ForgotPasscodeSchema,
  ResetPasscodeSchema,
  SetTransactionPinSchema,
  ChangeTransactionPinSchema,
  DeleteTransactionPinSchema,
  SetUppSchema,
  ChangeUppSchema,
  RevokeUniversalIdSchema,
  UnlockSchema,
} from './auth.schema';
import * as AuthService from './auth.service';
import * as SessionService from './session.service';
import { resendOtp } from './otp.service';
import { successResponse } from '../../common/types/api';
import { AppError, ErrorCode } from '../../common/errors/AppError';
import { config } from '../../config';

function ip(req: Request): string {
  return req.ip ?? '0.0.0.0';
}
function ua(req: Request): string {
  return req.headers['user-agent'] ?? 'unknown';
}

// ---------------------------------------------------------------------------
// Step 1 — Initiate registration
// ---------------------------------------------------------------------------
export async function initiateRegistration(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const body = InitiateRegistrationSchema.parse(req.body);
    const result = await AuthService.initiateRegistration(body.contact, body.contact_type);
    const cfg = config();
    res.status(201).json(
      successResponse({
        registration_id: result.registration_id,
        contact_type: result.contact_type,
        otp_expires_at: result.otp_expires_at,
        message: `A verification code has been sent to your ${body.contact_type}.`,
        ...(cfg.isDevelopment
          ? { _dev_note: 'Check server logs for OTP in development mode.' }
          : {}),
      }),
    );
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// Step 2 — Verify OTP
// ---------------------------------------------------------------------------
export async function verifyRegistrationOtp(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const body = VerifyOtpSchema.parse(req.body);
    // contact_type comes from the body — client knows what channel they used
    const contactType = (req.body as { contact_type?: string }).contact_type as
      | 'phone'
      | 'email'
      | undefined;
    if (!contactType || !['phone', 'email'].includes(contactType)) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'contact_type must be "phone" or "email".');
    }
    await AuthService.verifyRegistrationOtp(body.registration_id, body.otp, contactType);
    res.status(200).json(
      successResponse({
        verified: true,
        message: 'OTP verified. You can now complete your registration.',
      }),
    );
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// Step 2b — Resend OTP
// ---------------------------------------------------------------------------
export async function resendRegistrationOtp(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const body = ResendOtpSchema.parse(req.body);
    const contactType = (req.body as { contact_type?: string }).contact_type as
      | 'phone'
      | 'email'
      | undefined;
    if (!contactType || !['phone', 'email'].includes(contactType)) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'contact_type is required.');
    }
    await resendOtp(body.registration_id, contactType);
    const cfg = config();
    res.status(200).json(
      successResponse({
        message: 'A new verification code has been sent.',
        expires_at: new Date(Date.now() + cfg.otpTtlSeconds * 1000),
      }),
    );
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// Step 3 — Check username availability
// ---------------------------------------------------------------------------
export async function checkUsername(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { username } = CheckUsernameSchema.parse(req.query);
    const available = await AuthService.checkUsernameAvailable(username);
    res.status(200).json(
      successResponse({
        username: username.toLowerCase(),
        available,
        message: available ? 'Username is available.' : 'Username is already taken.',
      }),
    );
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// Step 4 — Complete registration
// ---------------------------------------------------------------------------
export async function completeRegistration(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const body = CompleteRegistrationSchema.parse(req.body);
    const result = await AuthService.completeRegistration({
      registration_id: body.registration_id,
      username: body.username,
      login_passcode: body.login_passcode,
      device_id: body.device_id,
      fcm_token: body.fcm_token,
      ip_address: ip(req),
      user_agent: ua(req),
    });
    res.status(201).json(successResponse(result));
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// Login / Logout / Refresh / Me
// ---------------------------------------------------------------------------
export async function login(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = LoginSchema.parse(req.body);
    const result = await AuthService.login({
      contact: body.contact,
      contact_type: body.contact_type,
      login_passcode: body.login_passcode,
      device_id: body.device_id,
      fcm_token: body.fcm_token,
      ip_address: ip(req),
      user_agent: ua(req),
    });
    res.status(200).json(successResponse(result));
  } catch (err) {
    next(err);
  }
}

export async function refreshToken(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = RefreshTokenSchema.parse(req.body);
    const tokens = await SessionService.rotateRefreshToken({
      rawRefreshToken: body.refresh_token,
      deviceId: body.device_id,
      ipAddress: ip(req),
      userAgent: ua(req),
    });
    res.status(200).json(successResponse(tokens));
  } catch (err) {
    next(err);
  }
}

export async function unlockWithPasscode(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const body = UnlockSchema.parse(req.body);
    const tokens = await AuthService.unlockWithPasscode({
      rawRefreshToken: body.refresh_token,
      login_passcode: body.login_passcode,
      device_id: (req.headers['x-device-id'] as string) ?? 'unknown',
      ip_address: ip(req),
      user_agent: ua(req),
    });
    res.json(successResponse(tokens));
  } catch (err) {
    next(err);
  }
}

export async function logout(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = LogoutSchema.parse(req.body);
    await SessionService.revokeSession(body.refresh_token);
    res.status(200).json(successResponse({ logged_out: true }));
  } catch (err) {
    next(err);
  }
}

export async function logoutAll(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const count = await SessionService.revokeAllSessions(req.user!.sub);
    res.status(200).json(successResponse({ sessions_revoked: count }));
  } catch (err) {
    next(err);
  }
}

export async function getMe(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = (await import('../../common/utils/prisma.js')).prisma as any;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const user = await db.user.findUniqueOrThrow({
      where: { id: req.user!.sub },
      select: {
        id: true,
        phone: true,
        email: true,
        username: true,
        universal_id: true,
        kyc_tier: true,
        account_status: true,
        created_at: true,
        auth: { select: { transaction_pin_hash: true, upp_hash: true } },
      },
    });
    const u = user as {
      id: string;
      phone: string | null;
      email: string | null;
      username: string;
      universal_id: string;
      kyc_tier: number;
      account_status: string;
      created_at: Date;
      auth: { transaction_pin_hash: string | null; upp_hash: string | null };
    };
    res.status(200).json(
      successResponse({
        id: u.id,
        phone: u.phone,
        email: u.email,
        username: u.username,
        universal_id: u.universal_id,
        kyc_tier: u.kyc_tier,
        account_status: u.account_status,
        has_transaction_pin: u.auth.transaction_pin_hash !== null,
        has_upp: u.auth.upp_hash !== null,
        created_at: u.created_at,
      }),
    );
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// Settings — Passcode
// ---------------------------------------------------------------------------
export async function changePasscode(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const body = ChangePasscodeSchema.parse(req.body);
    const result = await AuthService.changePasscode(
      req.user!.sub,
      req.user!.session_id,
      body.current_passcode,
      body.new_passcode,
    );
    res.status(200).json(successResponse(result));
  } catch (err) {
    next(err);
  }
}

export async function forgotPasscode(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const body = ForgotPasscodeSchema.parse(req.body);
    const result = await AuthService.initiateForgotPasscode(body.contact, body.contact_type);
    res.status(200).json(successResponse(result));
  } catch (err) {
    next(err);
  }
}

export async function resetPasscode(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const body = ResetPasscodeSchema.parse(req.body);
    const tokens = await AuthService.resetPasscode({
      reset_token: body.reset_token,
      otp: body.otp,
      new_passcode: body.new_passcode,
      device_id: body.device_id,
      fcm_token: body.fcm_token,
      ip_address: ip(req),
      user_agent: ua(req),
    });
    res.status(200).json(successResponse({ tokens }));
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// Settings — Transaction PIN
// ---------------------------------------------------------------------------
export async function setTransactionPin(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const body = SetTransactionPinSchema.parse(req.body);
    await AuthService.setTransactionPin(req.user!.sub, body.login_passcode, body.transaction_pin);
    res.status(200).json(successResponse({ pin_set: true }));
  } catch (err) {
    next(err);
  }
}

export async function changeTransactionPin(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const body = ChangeTransactionPinSchema.parse(req.body);
    await AuthService.changeTransactionPin(req.user!.sub, body.current_pin, body.new_pin);
    res.status(200).json(successResponse({ changed: true }));
  } catch (err) {
    next(err);
  }
}

export async function deleteTransactionPin(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const body = DeleteTransactionPinSchema.parse(req.body);
    await AuthService.deleteTransactionPin(req.user!.sub, body.login_passcode);
    res.status(200).json(successResponse({ deleted: true }));
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// Settings — Universal Payment PIN
// ---------------------------------------------------------------------------
export async function setUpp(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = SetUppSchema.parse(req.body);
    await AuthService.setUpp(req.user!.sub, body.login_passcode, body.upp);
    res.status(200).json(successResponse({ upp_set: true }));
  } catch (err) {
    next(err);
  }
}

export async function changeUpp(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = ChangeUppSchema.parse(req.body);
    await AuthService.changeUpp(req.user!.sub, body.current_upp, body.new_upp);
    res.status(200).json(successResponse({ changed: true }));
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// Settings — Universal ID revocation
// ---------------------------------------------------------------------------
export async function revokeUniversalId(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const body = RevokeUniversalIdSchema.parse(req.body);
    const result = await AuthService.revokeUniversalId(req.user!.sub, body.login_passcode);
    res.status(200).json(successResponse(result));
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// Settings — Sessions
// ---------------------------------------------------------------------------
export async function listSessions(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = (await import('../../common/utils/prisma.js')).prisma as any;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const sessions = await db.deviceSession.findMany({
      where: { user_id: req.user!.sub, is_revoked: false },
      orderBy: { last_active: 'desc' },
      select: {
        id: true,
        device_id: true,
        ip_address: true,
        user_agent: true,
        last_active: true,
        created_at: true,
      },
    });
    const result = (
      sessions as Array<{
        id: string;
        device_id: string;
        ip_address: string;
        user_agent: string;
        last_active: Date;
        created_at: Date;
      }>
    ).map((s) => ({ ...s, is_current: s.id === req.user!.session_id }));
    res.status(200).json(successResponse(result));
  } catch (err) {
    next(err);
  }
}

export async function revokeSession(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const id = req.params['id'] as string | undefined;
    if (!id) throw new AppError(ErrorCode.VALIDATION_ERROR, 'Session ID is required.');
    await SessionService.revokeSessionById(id, req.user!.sub, req.user!.session_id);
    res.status(200).json(successResponse({ revoked: true }));
  } catch (err) {
    next(err);
  }
}
