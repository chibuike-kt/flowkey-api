/**
 * FlowKey — Auth Service (v2)
 *
 * Registration flow:
 *   1. initiate()     — phone or email → send OTP
 *   2. verifyOtp()    — verify OTP → mark verified in Redis
 *   3. checkUsername()— real-time availability check
 *   4. complete()     — username + passcode → activate account, issue tokens
 *
 * Login: phone or email + passcode → tokens
 */

import * as argon2 from 'argon2';
import { config } from '../../config';
import { prisma } from '../../common/utils/prisma';
import { redis } from '../../common/utils/redis';
import { AppError, ErrorCode } from '../../common/errors/AppError';
import { generateOtp, verifyOtp } from './otp.service';
import { createSession, revokeOtherSessions, revokeAllSessions } from './session.service';
import { assertNotLocked, recordFailedAttempt, clearLockout } from './lockout.service';
import {
  generateUniversalId,
  canRevokeUniversalId,
  nextRevocationAllowedAt,
} from '../universal-id/universal-id.service';
import { sendOtpEmail, sendOtpSms, sendWelcomeEmail } from '../notifications/notification.service';
import type {
  InitiateResult,
  CompleteRegistrationResult,
  UserProfileResult,
  AuthTokens,
} from './auth.types';

const db = prisma as any;

// ---------------------------------------------------------------------------
// Argon2id helpers
// ---------------------------------------------------------------------------

function argon2Opts(): argon2.Options & { raw?: false } {
  const cfg = config();
  return {
    type: argon2.argon2id,
    memoryCost: cfg.argon2MemoryCost,
    timeCost: cfg.argon2TimeCost,
    parallelism: cfg.argon2Parallelism,
    hashLength: cfg.argon2OutputLength,
  };
}

function argon2ParamsJson(): string {
  const cfg = config();
  return JSON.stringify({
    m: cfg.argon2MemoryCost,
    t: cfg.argon2TimeCost,
    p: cfg.argon2Parallelism,
    l: cfg.argon2OutputLength,
  });
}

async function hashValue(val: string): Promise<string> {
  return argon2.hash(val, argon2Opts());
}

async function verifyValue(hash: string, val: string): Promise<boolean> {
  return argon2.verify(hash, val);
}

// ---------------------------------------------------------------------------
// Step 1 — Initiate registration
// ---------------------------------------------------------------------------

export async function initiateRegistration(
  contact: string,
  contactType: 'phone' | 'email',
): Promise<InitiateResult> {
  // Check uniqueness
  if (contactType === 'phone') {
    const existing = await db.user.findUnique({ where: { phone: contact }, select: { id: true } });
    if (existing)
      throw new AppError(
        ErrorCode.PHONE_ALREADY_REGISTERED,
        'An account with this phone number already exists.',
      );
  } else {
    const existing = await db.user.findUnique({ where: { email: contact }, select: { id: true } });
    if (existing)
      throw new AppError(
        ErrorCode.EMAIL_ALREADY_REGISTERED,
        'An account with this email address already exists.',
      );
  }

  // Create pending user
  const user = await db.user.create({
    data: {
      phone: contactType === 'phone' ? contact : null,
      email: contactType === 'email' ? contact : null,
      universal_id: `PENDING-${Date.now()}`, // placeholder
      registration_channel: contactType,
      registration_step: 'otp_pending',
      account_status: 'pending_verification',
      auth: { create: { argon2_params: argon2ParamsJson() } },
    },
    select: { id: true },
  });

  const userId = (user as { id: string }).id;
  const otp = await generateOtp(userId, contactType);

  // Send OTP
  if (contactType === 'email') {
    await sendOtpEmail(contact, otp, 'Verify your email address');
  } else {
    await sendOtpSms(contact, otp);
  }

  const cfg = config();
  return {
    registration_id: userId,
    contact_type: contactType,
    otp_expires_at: new Date(Date.now() + cfg.otpTtlSeconds * 1000),
  };
}

// ---------------------------------------------------------------------------
// Step 2 — Verify OTP
// ---------------------------------------------------------------------------

export async function verifyRegistrationOtp(
  userId: string,
  otp: string,
  contactType: 'phone' | 'email',
): Promise<void> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, registration_step: true, registration_channel: true },
  });

  if (!user) throw new AppError(ErrorCode.NOT_FOUND, 'Registration session not found.');

  const typedUser = user as { id: string; registration_step: string; registration_channel: string };
  if (typedUser.registration_step !== 'otp_pending') {
    throw new AppError(ErrorCode.CONFLICT, 'OTP has already been verified.');
  }
  if (typedUser.registration_channel !== contactType) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'OTP type does not match registration channel.');
  }

  await verifyOtp(userId, contactType, otp);

  // Mark OTP as verified
  await db.user.update({
    where: { id: userId },
    data: { registration_step: 'otp_verified' },
  });
}

// ---------------------------------------------------------------------------
// Step 3 — Check username availability
// ---------------------------------------------------------------------------

export async function checkUsernameAvailable(username: string): Promise<boolean> {
  const normalised = username.toLowerCase();
  const existing = await db.user.findFirst({
    where: { username: { equals: normalised, mode: 'insensitive' } },
    select: { id: true },
  });
  return existing === null;
}

// ---------------------------------------------------------------------------
// Step 4 — Complete registration
// ---------------------------------------------------------------------------

export async function completeRegistration(payload: {
  registration_id: string;
  username: string;
  login_passcode: string;
  device_id: string;
  fcm_token: string;
  ip_address: string;
  user_agent: string;
}): Promise<CompleteRegistrationResult> {
  const user = await db.user.findUnique({
    where: { id: payload.registration_id },
    select: { id: true, registration_step: true, email: true, display_name: true },
  });

  if (!user) throw new AppError(ErrorCode.NOT_FOUND, 'Registration session not found.');

  const typedUser = user as {
    id: string;
    registration_step: string;
    email: string | null;
    display_name: string | null;
  };

  if (typedUser.registration_step !== 'otp_verified') {
    throw new AppError(
      ErrorCode.CONFLICT,
      'Please verify your OTP before completing registration.',
    );
  }

  // Check username not taken
  const available = await checkUsernameAvailable(payload.username);
  if (!available) {
    throw new AppError(
      ErrorCode.CONFLICT,
      'This username is already taken. Please choose another.',
    );
  }

  // Generate Universal ID
  const universalId = await generateUniversalId(async (id) => {
    // Check both active users and history
    const [activeUser, history] = await Promise.all([
      db.user.findUnique({ where: { universal_id: id }, select: { id: true } }),
      db.universalIdHistory.findUnique({ where: { universal_id: id }, select: { id: true } }),
    ]);
    return activeUser !== null || history !== null;
  });

  const passcodeHash = await hashValue(payload.login_passcode);
  const username = payload.username.toLowerCase();

  // Atomic activation
  const activated = await db.$transaction(async (tx: Record<string, unknown>) => {
    const txDb = tx as any;

    const updated = await txDb.user.update({
      where: { id: payload.registration_id },
      data: {
        username,
        universal_id: universalId,
        account_status: 'active',
        registration_step: 'active',
      },
      select: {
        id: true,
        phone: true,
        email: true,
        username: true,
        universal_id: true,
        kyc_tier: true,
        account_status: true,
        created_at: true,
      },
    });

    await txDb.userAuth.update({
      where: { user_id: payload.registration_id },
      data: { login_passcode_hash: passcodeHash, argon2_params: argon2ParamsJson() },
    });

    await txDb.wallet.create({ data: { user_id: payload.registration_id } });
    await txDb.notificationPref.create({ data: { user_id: payload.registration_id } });
    await txDb.auditLog.create({
      data: {
        actor_id: payload.registration_id,
        actor_type: 'user',
        action: 'user.account_activated',
        target_type: 'user',
        target_id: payload.registration_id,
        previous_hash: 'GENESIS',
        metadata: { universal_id: universalId, username },
      },
    });

    return updated;
  });

  const typedActivated = activated as {
    id: string;
    phone: string | null;
    email: string | null;
    username: string;
    universal_id: string;
    kyc_tier: number;
    account_status: string;
    created_at: Date;
  };

  // Send welcome email if registered via email
  if (typedUser.email) {
    void sendWelcomeEmail(typedUser.email, typedActivated.username);
  }

  const tokens = await createSession({
    userId: typedActivated.id,
    deviceId: payload.device_id,
    ipAddress: payload.ip_address,
    userAgent: payload.user_agent,
    fcmToken: payload.fcm_token,
    kyc_tier: typedActivated.kyc_tier,
  });

  return {
    tokens,
    user: {
      id: typedActivated.id,
      phone: typedActivated.phone,
      email: typedActivated.email,
      username: typedActivated.username,
      universal_id: typedActivated.universal_id,
      kyc_tier: typedActivated.kyc_tier,
      account_status: typedActivated.account_status,
      has_transaction_pin: false,
      has_upp: false,
      created_at: typedActivated.created_at,
    },
  };
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

export async function login(payload: {
  contact: string;
  contact_type: 'phone' | 'email';
  login_passcode: string;
  device_id: string;
  fcm_token: string;
  ip_address: string;
  user_agent: string;
}): Promise<{ tokens: AuthTokens; user: UserProfileResult }> {
  const whereClause =
    payload.contact_type === 'phone' ? { phone: payload.contact } : { email: payload.contact };

  const user = await db.user.findUnique({
    where: whereClause,
    select: {
      id: true,
      phone: true,
      email: true,
      username: true,
      universal_id: true,
      kyc_tier: true,
      account_status: true,
      created_at: true,
      auth: {
        select: {
          login_passcode_hash: true,
          login_passcode_failed_attempts: true,
          login_passcode_locked_until: true,
          login_passcode_hard_locked: true,
          login_passcode_lockout_count: true,
          transaction_pin_hash: true,
          upp_hash: true,
        },
      },
    },
  });

  // Dummy hash — prevents timing attack revealing user existence
  const dummyHash = '$argon2id$v=19$m=65536,t=3,p=4$dummysalt16bytes$dummyhash32byteslong1234';
  const passcodeHash =
    user !== null
      ? ((user as { auth: { login_passcode_hash: string | null } }).auth.login_passcode_hash ??
        dummyHash)
      : dummyHash;

  if (user !== null) {
    const u = user as {
      id: string;
      account_status: string;
      auth: {
        login_passcode_locked_until: Date | null;
        login_passcode_hard_locked: boolean;
        login_passcode_failed_attempts: number;
        login_passcode_lockout_count: number;
      };
    };

    if (u.account_status === 'frozen')
      throw new AppError(
        ErrorCode.ACCOUNT_FROZEN,
        'Your account has been frozen. Please contact support.',
      );
    if (u.account_status !== 'active')
      throw new AppError(ErrorCode.UNAUTHORIZED, 'This account is not active.');

    await assertNotLocked(u.id, 'passcode', () =>
      Promise.resolve({
        hard_locked: u.auth.login_passcode_hard_locked,
        locked_until: u.auth.login_passcode_locked_until,
      }),
    );
  }

  const isValid = await verifyValue(passcodeHash, payload.login_passcode);

  if (!isValid || user === null) {
    if (user !== null) {
      const u = user as {
        id: string;
        auth: { login_passcode_failed_attempts: number; login_passcode_lockout_count: number };
      };
      const lockout = await recordFailedAttempt(
        u.id,
        'passcode',
        u.auth.login_passcode_failed_attempts,
        u.auth.login_passcode_lockout_count,
      );
      await db.userAuth.update({
        where: { user_id: u.id },
        data: {
          login_passcode_failed_attempts: lockout.newFailCount,
          login_passcode_locked_until: lockout.lockedUntil,
          login_passcode_hard_locked: lockout.hardLocked,
          login_passcode_lockout_count: lockout.newLockoutCount,
        },
      });
    }
    throw new AppError(ErrorCode.INVALID_CREDENTIALS, 'Incorrect credentials.');
  }

  const u = user as {
    id: string;
    phone: string | null;
    email: string | null;
    username: string;
    universal_id: string;
    kyc_tier: number;
    account_status: string;
    created_at: Date;
    auth: {
      login_passcode_failed_attempts: number;
      login_passcode_lockout_count: number;
      transaction_pin_hash: string | null;
      upp_hash: string | null;
    };
  };

  const cleared = await clearLockout(u.id, 'passcode');
  await db.userAuth.update({
    where: { user_id: u.id },
    data: {
      login_passcode_failed_attempts: cleared.newFailCount,
      login_passcode_locked_until: cleared.lockedUntil,
      login_passcode_hard_locked: cleared.hardLocked,
    },
  });

  const tokens = await createSession({
    userId: u.id,
    deviceId: payload.device_id,
    ipAddress: payload.ip_address,
    userAgent: payload.user_agent,
    fcmToken: payload.fcm_token,
    kyc_tier: u.kyc_tier,
  });

  return {
    tokens,
    user: {
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
    },
  };
}

// ---------------------------------------------------------------------------
// Passcode management
// ---------------------------------------------------------------------------

export async function changePasscode(
  userId: string,
  sessionId: string,
  currentPasscode: string,
  newPasscode: string,
): Promise<{ sessions_revoked: number }> {
  const auth = await db.userAuth.findUnique({
    where: { user_id: userId },
    select: {
      login_passcode_hash: true,
      login_passcode_hard_locked: true,
      login_passcode_locked_until: true,
      login_passcode_failed_attempts: true,
      login_passcode_lockout_count: true,
    },
  });

  if (!auth) throw new AppError(ErrorCode.NOT_FOUND, 'User not found.');
  const a = auth as {
    login_passcode_hash: string | null;
    login_passcode_hard_locked: boolean;
    login_passcode_locked_until: Date | null;
    login_passcode_failed_attempts: number;
    login_passcode_lockout_count: number;
  };

  if (!a.login_passcode_hash) throw new AppError(ErrorCode.NOT_FOUND, 'No passcode set.');

  await assertNotLocked(userId, 'passcode', () =>
    Promise.resolve({
      hard_locked: a.login_passcode_hard_locked,
      locked_until: a.login_passcode_locked_until,
    }),
  );

  const isValid = await verifyValue(a.login_passcode_hash, currentPasscode);
  if (!isValid) {
    const lockout = await recordFailedAttempt(
      userId,
      'passcode',
      a.login_passcode_failed_attempts,
      a.login_passcode_lockout_count,
    );
    await db.userAuth.update({
      where: { user_id: userId },
      data: {
        login_passcode_failed_attempts: lockout.newFailCount,
        login_passcode_locked_until: lockout.lockedUntil,
        login_passcode_hard_locked: lockout.hardLocked,
        login_passcode_lockout_count: lockout.newLockoutCount,
      },
    });
    throw new AppError(ErrorCode.INVALID_CREDENTIALS, 'Current passcode is incorrect.');
  }

  const newHash = await hashValue(newPasscode);
  await db.userAuth.update({
    where: { user_id: userId },
    data: {
      login_passcode_hash: newHash,
      login_passcode_failed_attempts: 0,
      login_passcode_locked_until: null,
      login_passcode_hard_locked: false,
      argon2_params: argon2ParamsJson(),
    },
  });

  return { sessions_revoked: await revokeOtherSessions(userId, sessionId) };
}

export async function initiateForgotPasscode(
  contact: string,
  contactType: 'phone' | 'email',
): Promise<{ reset_token: string; expires_at: Date }> {
  const whereClause = contactType === 'phone' ? { phone: contact } : { email: contact };
  const user = await db.user.findUnique({
    where: whereClause,
    select: { id: true, account_status: true, email: true },
  });

  if (!user) throw new AppError(ErrorCode.NOT_FOUND, 'No account found with that contact.');
  const u = user as { id: string; account_status: string; email: string | null };
  if (u.account_status !== 'active')
    throw new AppError(ErrorCode.UNAUTHORIZED, 'Account is not active.');

  const otp = await generateOtp(u.id, contactType);
  if (contactType === 'email' && u.email) {
    await sendOtpEmail(u.email, otp, 'Reset your passcode');
  } else {
    await sendOtpSms(contact, otp);
  }

  const token = await generateResetToken(u.id);
  return { reset_token: token, expires_at: new Date(Date.now() + 15 * 60 * 1000) };
}

export async function resetPasscode(payload: {
  reset_token: string;
  otp: string;
  new_passcode: string;
  device_id: string;
  fcm_token: string;
  ip_address: string;
  user_agent: string;
}): Promise<AuthTokens> {
  const userId = await validateResetToken(payload.reset_token);
  // Get the registration channel to know which OTP type to verify
  const userRecord = await db.user.findUniqueOrThrow({
    where: { id: userId },
    select: { registration_channel: true, kyc_tier: true },
  });
  const { registration_channel, kyc_tier } = userRecord as {
    registration_channel: string;
    kyc_tier: number;
  };

  await verifyOtp(userId, registration_channel as 'phone' | 'email', payload.otp);

  const newHash = await hashValue(payload.new_passcode);
  await db.userAuth.update({
    where: { user_id: userId },
    data: {
      login_passcode_hash: newHash,
      login_passcode_failed_attempts: 0,
      login_passcode_locked_until: null,
      login_passcode_hard_locked: false,
      login_passcode_lockout_count: 0,
      argon2_params: argon2ParamsJson(),
    },
  });
  await revokeAllSessions(userId);
  await invalidateResetToken(payload.reset_token);

  return createSession({
    userId,
    deviceId: payload.device_id,
    ipAddress: payload.ip_address,
    userAgent: payload.user_agent,
    fcmToken: payload.fcm_token,
    kyc_tier,
  });
}

// ---------------------------------------------------------------------------
// Transaction PIN
// ---------------------------------------------------------------------------

export async function setTransactionPin(
  userId: string,
  loginPasscode: string,
  pin: string,
): Promise<void> {
  const auth = await db.userAuth.findUnique({
    where: { user_id: userId },
    select: { login_passcode_hash: true, transaction_pin_hash: true },
  });
  if (!auth) throw new AppError(ErrorCode.NOT_FOUND, 'User not found.');
  const a = auth as { login_passcode_hash: string | null; transaction_pin_hash: string | null };
  if (!a.login_passcode_hash) throw new AppError(ErrorCode.NOT_FOUND, 'No passcode set.');
  if (a.transaction_pin_hash)
    throw new AppError(ErrorCode.CONFLICT, 'PIN already set. Use change PIN.');
  if (!(await verifyValue(a.login_passcode_hash, loginPasscode)))
    throw new AppError(ErrorCode.INVALID_CREDENTIALS, 'Login passcode is incorrect.');
  await db.userAuth.update({
    where: { user_id: userId },
    data: { transaction_pin_hash: await hashValue(pin) },
  });
}

export async function changeTransactionPin(
  userId: string,
  currentPin: string,
  newPin: string,
): Promise<void> {
  const auth = await db.userAuth.findUnique({
    where: { user_id: userId },
    select: {
      transaction_pin_hash: true,
      transaction_pin_failed_attempts: true,
      transaction_pin_locked_until: true,
      transaction_pin_hard_locked: true,
      transaction_pin_lockout_count: true,
    },
  });
  if (!auth) throw new AppError(ErrorCode.NOT_FOUND, 'User not found.');
  const a = auth as {
    transaction_pin_hash: string | null;
    transaction_pin_failed_attempts: number;
    transaction_pin_locked_until: Date | null;
    transaction_pin_hard_locked: boolean;
    transaction_pin_lockout_count: number;
  };
  if (!a.transaction_pin_hash)
    throw new AppError(ErrorCode.NOT_FOUND, 'No PIN set. Use set PIN first.');
  await assertNotLocked(userId, 'pin', () =>
    Promise.resolve({
      hard_locked: a.transaction_pin_hard_locked,
      locked_until: a.transaction_pin_locked_until,
    }),
  );
  const isValid = await verifyValue(a.transaction_pin_hash, currentPin);
  if (!isValid) {
    const lockout = await recordFailedAttempt(
      userId,
      'pin',
      a.transaction_pin_failed_attempts,
      a.transaction_pin_lockout_count,
    );
    await db.userAuth.update({
      where: { user_id: userId },
      data: {
        transaction_pin_failed_attempts: lockout.newFailCount,
        transaction_pin_locked_until: lockout.lockedUntil,
        transaction_pin_hard_locked: lockout.hardLocked,
        transaction_pin_lockout_count: lockout.newLockoutCount,
      },
    });
    throw new AppError(ErrorCode.INVALID_CREDENTIALS, 'Current PIN is incorrect.');
  }
  const cleared = await clearLockout(userId, 'pin');
  await db.userAuth.update({
    where: { user_id: userId },
    data: {
      transaction_pin_hash: await hashValue(newPin),
      transaction_pin_failed_attempts: cleared.newFailCount,
      transaction_pin_locked_until: cleared.lockedUntil,
      transaction_pin_hard_locked: cleared.hardLocked,
    },
  });
}

export async function deleteTransactionPin(userId: string, loginPasscode: string): Promise<void> {
  const auth = await db.userAuth.findUnique({
    where: { user_id: userId },
    select: { login_passcode_hash: true },
  });
  if (!auth) throw new AppError(ErrorCode.NOT_FOUND, 'User not found.');
  const a = auth as { login_passcode_hash: string | null };
  if (!a.login_passcode_hash) throw new AppError(ErrorCode.NOT_FOUND, 'No passcode set.');
  if (!(await verifyValue(a.login_passcode_hash, loginPasscode)))
    throw new AppError(ErrorCode.INVALID_CREDENTIALS, 'Login passcode is incorrect.');
  await db.userAuth.update({
    where: { user_id: userId },
    data: {
      transaction_pin_hash: null,
      transaction_pin_failed_attempts: 0,
      transaction_pin_locked_until: null,
      transaction_pin_hard_locked: false,
    },
  });
}

export async function verifyTransactionPin(userId: string, pin: string): Promise<void> {
  const auth = await db.userAuth.findUnique({
    where: { user_id: userId },
    select: {
      transaction_pin_hash: true,
      transaction_pin_failed_attempts: true,
      transaction_pin_locked_until: true,
      transaction_pin_hard_locked: true,
      transaction_pin_lockout_count: true,
    },
  });
  if (!auth) throw new AppError(ErrorCode.NOT_FOUND, 'User not found.');
  const a = auth as {
    transaction_pin_hash: string | null;
    transaction_pin_failed_attempts: number;
    transaction_pin_locked_until: Date | null;
    transaction_pin_hard_locked: boolean;
    transaction_pin_lockout_count: number;
  };
  if (!a.transaction_pin_hash)
    throw new AppError(ErrorCode.NOT_FOUND, 'Transaction PIN not set. Please set your PIN first.');
  await assertNotLocked(userId, 'pin', () =>
    Promise.resolve({
      hard_locked: a.transaction_pin_hard_locked,
      locked_until: a.transaction_pin_locked_until,
    }),
  );
  const isValid = await verifyValue(a.transaction_pin_hash, pin);
  if (!isValid) {
    const lockout = await recordFailedAttempt(
      userId,
      'pin',
      a.transaction_pin_failed_attempts,
      a.transaction_pin_lockout_count,
    );
    await db.userAuth.update({
      where: { user_id: userId },
      data: {
        transaction_pin_failed_attempts: lockout.newFailCount,
        transaction_pin_locked_until: lockout.lockedUntil,
        transaction_pin_hard_locked: lockout.hardLocked,
        transaction_pin_lockout_count: lockout.newLockoutCount,
      },
    });
    throw new AppError(ErrorCode.INVALID_CREDENTIALS, 'Incorrect PIN.');
  }
  const cleared = await clearLockout(userId, 'pin');
  await db.userAuth.update({
    where: { user_id: userId },
    data: {
      transaction_pin_failed_attempts: cleared.newFailCount,
      transaction_pin_locked_until: cleared.lockedUntil,
      transaction_pin_hard_locked: cleared.hardLocked,
    },
  });
}

// ---------------------------------------------------------------------------
// Universal Payment PIN (UPP)
// ---------------------------------------------------------------------------

export async function setUpp(userId: string, loginPasscode: string, upp: string): Promise<void> {
  const auth = await db.userAuth.findUnique({
    where: { user_id: userId },
    select: { login_passcode_hash: true, upp_hash: true },
  });
  if (!auth) throw new AppError(ErrorCode.NOT_FOUND, 'User not found.');
  const a = auth as { login_passcode_hash: string | null; upp_hash: string | null };
  if (!a.login_passcode_hash) throw new AppError(ErrorCode.NOT_FOUND, 'No passcode set.');
  if (a.upp_hash)
    throw new AppError(ErrorCode.CONFLICT, 'Universal Payment PIN already set. Use change UPP.');
  if (!(await verifyValue(a.login_passcode_hash, loginPasscode)))
    throw new AppError(ErrorCode.INVALID_CREDENTIALS, 'Login passcode is incorrect.');
  await db.userAuth.update({
    where: { user_id: userId },
    data: { upp_hash: await hashValue(upp) },
  });
}

export async function changeUpp(userId: string, currentUpp: string, newUpp: string): Promise<void> {
  const auth = await db.userAuth.findUnique({
    where: { user_id: userId },
    select: {
      upp_hash: true,
      upp_failed_attempts: true,
      upp_locked_until: true,
      upp_hard_locked: true,
      upp_lockout_count: true,
    },
  });
  if (!auth) throw new AppError(ErrorCode.NOT_FOUND, 'User not found.');
  const a = auth as {
    upp_hash: string | null;
    upp_failed_attempts: number;
    upp_locked_until: Date | null;
    upp_hard_locked: boolean;
    upp_lockout_count: number;
  };
  if (!a.upp_hash) throw new AppError(ErrorCode.NOT_FOUND, 'No UPP set. Use set UPP first.');
  await assertNotLocked(userId, 'passcode', () =>
    Promise.resolve({ hard_locked: a.upp_hard_locked, locked_until: a.upp_locked_until }),
  );
  const isValid = await verifyValue(a.upp_hash, currentUpp);
  if (!isValid) {
    const lockout = await recordFailedAttempt(
      userId,
      'passcode',
      a.upp_failed_attempts,
      a.upp_lockout_count,
    );
    await db.userAuth.update({
      where: { user_id: userId },
      data: {
        upp_failed_attempts: lockout.newFailCount,
        upp_locked_until: lockout.lockedUntil,
        upp_hard_locked: lockout.hardLocked,
        upp_lockout_count: lockout.newLockoutCount,
      },
    });
    throw new AppError(ErrorCode.INVALID_CREDENTIALS, 'Current UPP is incorrect.');
  }
  await db.userAuth.update({
    where: { user_id: userId },
    data: {
      upp_hash: await hashValue(newUpp),
      upp_failed_attempts: 0,
      upp_locked_until: null,
      upp_hard_locked: false,
    },
  });
}

// ---------------------------------------------------------------------------
// Universal ID revocation
// ---------------------------------------------------------------------------

export async function revokeUniversalId(
  userId: string,
  loginPasscode: string,
): Promise<{ new_universal_id: string; next_revocation_allowed_at: Date }> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      universal_id: true,
      universal_id_revoked_at: true,
      auth: { select: { login_passcode_hash: true } },
    },
  });
  if (!user) throw new AppError(ErrorCode.NOT_FOUND, 'User not found.');
  const u = user as {
    universal_id: string;
    universal_id_revoked_at: Date | null;
    auth: { login_passcode_hash: string | null };
  };

  if (!(await verifyValue(u.auth.login_passcode_hash ?? '', loginPasscode)))
    throw new AppError(ErrorCode.INVALID_CREDENTIALS, 'Login passcode is incorrect.');

  if (!canRevokeUniversalId(u.universal_id_revoked_at)) {
    const allowedAt = nextRevocationAllowedAt(u.universal_id_revoked_at!);
    throw new AppError(
      ErrorCode.RATE_LIMITED,
      `You can only revoke your Universal ID once every 24 hours. Next allowed: ${allowedAt.toISOString()}`,
    );
  }

  // Generate new ID (also checks history table)
  const newId = await generateUniversalId(async (id) => {
    const [active, hist] = await Promise.all([
      db.user.findUnique({ where: { universal_id: id }, select: { id: true } }),
      db.universalIdHistory.findUnique({ where: { universal_id: id }, select: { id: true } }),
    ]);
    return active !== null || hist !== null;
  });

  const now = new Date();
  await db.$transaction([
    db.universalIdHistory.create({
      data: { user_id: userId, universal_id: u.universal_id, revoked_at: now },
    }),
    db.user.update({
      where: { id: userId },
      data: { universal_id: newId, universal_id_revoked_at: now },
    }),
  ]);

  return { new_universal_id: newId, next_revocation_allowed_at: nextRevocationAllowedAt(now) };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function generateResetToken(userId: string): Promise<string> {
  const { randomBytes } = await import('crypto');
  const token = randomBytes(32).toString('hex');
  await redis.set(`reset_token:${token}`, userId, 'EX', 15 * 60);
  return token;
}

async function validateResetToken(token: string): Promise<string> {
  const userId = await redis.get(`reset_token:${token}`);
  if (!userId)
    throw new AppError(
      ErrorCode.VALIDATION_ERROR,
      'Reset token is invalid or expired. Please restart the recovery process.',
    );
  return userId;
}

async function invalidateResetToken(token: string): Promise<void> {
  await redis.del(`reset_token:${token}`);
}

// placeholder to satisfy TS — user is declared in resetPasscode
declare const user: { kyc_tier: number };
