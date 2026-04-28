/**
 * FlowKey — Auth Controller
 *
 * Owns HTTP concerns only:
 *   - Parse and validate request body/params via Zod
 *   - Call the appropriate service method
 *   - Format the standard response envelope
 *   - Never contains business logic
 */

import type { Request, Response, NextFunction } from 'express';
import {
  RegisterSchema,
  VerifyOtpSchema,
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
} from './auth.schema';
import * as AuthService from './auth.service';
import * as SessionService from './session.service';
import { resendOtp } from './otp.service';
import { successResponse } from '../../common/types/api';
import { AppError, ErrorCode } from '../../common/errors/AppError';

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export async function register(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = RegisterSchema.parse(req.body);
    const result = await AuthService.register({
      phone: body.phone,
      email: body.email,
      display_name: body.display_name,
      login_passcode: body.login_passcode,
    });

    res.status(201).json(
      successResponse({
        user_id: result.user_id,
        message: 'Verification codes sent to your phone and email.',
        phone_otp_expires_at: result.phone_otp_expires_at,
        email_otp_expires_at: result.email_otp_expires_at,
      }),
    );
  } catch (err) {
    next(err);
  }
}

export async function verifyPhone(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = VerifyOtpSchema.parse(req.body);
    await AuthService.verifyPhoneOtp(body.user_id, body.otp);
    res.status(200).json(successResponse({ phone_verified: true }));
  } catch (err) {
    next(err);
  }
}

export async function resendPhoneOtp(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const body = ResendOtpSchema.parse(req.body);
    const otp = await resendOtp(body.user_id, 'phone');

    // TODO Phase 14: queue SMS delivery
    // In dev, OTP is returned in response for testing convenience
    const cfg = await import('../../config/index.js').then((m) => m.config());
    const expires_at = new Date(Date.now() + cfg.otpTtlSeconds * 1000);

    res.status(200).json(
      successResponse({
        expires_at,
        ...(cfg.isDevelopment ? { _dev_otp: otp } : {}),
      }),
    );
  } catch (err) {
    next(err);
  }
}

export async function verifyEmail(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = VerifyOtpSchema.parse(req.body);
    const result = await AuthService.verifyEmailOtp(
      body.user_id,
      body.otp,
      (req.body.device_id as string) ?? 'unknown',
      req.ip ?? '0.0.0.0',
      req.headers['user-agent'] ?? 'unknown',
      (req.body.fcm_token as string) ?? '',
    );
    res.status(200).json(successResponse(result));
  } catch (err) {
    next(err);
  }
}

export async function resendEmailOtp(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const body = ResendOtpSchema.parse(req.body);
    const otp = await resendOtp(body.user_id, 'email');

    // TODO Phase 14: queue email delivery
    const cfg = await import('../../config/index.js').then((m) => m.config());
    const expires_at = new Date(Date.now() + cfg.otpTtlSeconds * 1000);

    res.status(200).json(
      successResponse({
        expires_at,
        ...(cfg.isDevelopment ? { _dev_otp: otp } : {}),
      }),
    );
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// Login / logout
// ---------------------------------------------------------------------------

export async function login(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = LoginSchema.parse(req.body);
    const result = await AuthService.login({
      phone: body.phone,
      login_passcode: body.login_passcode,
      device_id: body.device_id,
      fcm_token: body.fcm_token,
      ip_address: req.ip ?? '0.0.0.0',
      user_agent: req.headers['user-agent'] ?? 'unknown',
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
      ipAddress: req.ip ?? '0.0.0.0',
      userAgent: req.headers['user-agent'] ?? 'unknown',
    });
    res.status(200).json(successResponse(tokens));
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
    const user = req.user!;
    const count = await SessionService.revokeAllSessions(user.sub);
    res.status(200).json(successResponse({ sessions_revoked: count }));
  } catch (err) {
    next(err);
  }
}

export async function getMe(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = req.user!;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = (await import('../../common/utils/prisma.js')).prisma as any;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const dbUser = await db.user.findUniqueOrThrow({
      where: { id: user.sub },
      select: {
        id: true,
        phone: true,
        email: true,
        display_name: true,
        universal_id: true,
        kyc_tier: true,
        account_status: true,
        created_at: true,
        auth: { select: { transaction_pin_hash: true } },
      },
    });

    const typedUser = dbUser as {
      id: string;
      phone: string;
      email: string;
      display_name: string;
      universal_id: string;
      kyc_tier: number;
      account_status: string;
      created_at: Date;
      auth: { transaction_pin_hash: string | null };
    };

    res.status(200).json(
      successResponse({
        id: typedUser.id,
        phone: typedUser.phone,
        email: typedUser.email,
        display_name: typedUser.display_name,
        universal_id: typedUser.universal_id,
        kyc_tier: typedUser.kyc_tier,
        account_status: typedUser.account_status,
        has_transaction_pin: typedUser.auth.transaction_pin_hash !== null,
        created_at: typedUser.created_at,
      }),
    );
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// Settings — passcode and PIN (called from settings router)
// ---------------------------------------------------------------------------

export async function changePasscode(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const body = ChangePasscodeSchema.parse(req.body);
    const user = req.user!;
    const result = await AuthService.changePasscode(
      user.sub,
      user.session_id,
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
    const result = await AuthService.initiateForgotPasscode(body.phone);
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
      phone_otp: body.phone_otp,
      email_otp: body.email_otp,
      new_passcode: body.new_passcode,
      device_id: (req.body.device_id as string) ?? 'unknown',
      ip_address: req.ip ?? '0.0.0.0',
      user_agent: req.headers['user-agent'] ?? 'unknown',
      fcm_token: (req.body.fcm_token as string) ?? '',
    });
    res.status(200).json(successResponse({ tokens }));
  } catch (err) {
    next(err);
  }
}

export async function setTransactionPin(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const body = SetTransactionPinSchema.parse(req.body);
    const user = req.user!;
    await AuthService.setTransactionPin(user.sub, body.login_passcode, body.transaction_pin);
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
    const user = req.user!;
    await AuthService.changeTransactionPin(user.sub, body.current_pin, body.new_pin);
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
    const user = req.user!;
    await AuthService.deleteTransactionPin(user.sub, body.login_passcode);
    res.status(200).json(successResponse({ deleted: true }));
  } catch (err) {
    next(err);
  }
}

export async function listSessions(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = req.user!;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = (await import('../../common/utils/prisma.js')).prisma as any;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const sessions = await db.deviceSession.findMany({
      where: { user_id: user.sub, is_revoked: false },
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

    const formatted = (
      sessions as Array<{
        id: string;
        device_id: string;
        ip_address: string;
        user_agent: string;
        last_active: Date;
        created_at: Date;
      }>
    ).map((s) => ({
      ...s,
      is_current: s.id === user.session_id,
    }));

    res.status(200).json(successResponse(formatted));
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
    const user = req.user!;
    const id = req.params['id'] as string | undefined;
    if (!id) throw new AppError(ErrorCode.VALIDATION_ERROR, 'Session ID is required.');
    await SessionService.revokeSessionById(id, user.sub, user.session_id);
    res.status(200).json(successResponse({ revoked: true }));
  } catch (err) {
    next(err);
  }
}
