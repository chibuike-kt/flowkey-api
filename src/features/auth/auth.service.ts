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
import {
  createSession,
  rotateRefreshToken,
  revokeSession,
  revokeOtherSessions,
  revokeAllSessions,
} from './session.service';
import { assertNotLocked, recordFailedAttempt, clearLockout } from './lockout.service';
import { hashRefreshToken } from './token.service';
import {
  generateUniversalId,
  canRevokeUniversalId,
  nextRevocationAllowedAt,
} from '../universal-id/universal-id.service';
import { authEventsTotal } from '../../common/metrics/index';
import { sendWelcomeEmail } from '../notifications/notification.service';
import { queueOtpEmail } from '../../queues/email.queue';
import { queueOtpSms } from '../../queues/sms.queue';
import type {
  InitiateResult,
  CompleteRegistrationResult,
  UserProfileResult,
  AuthTokens,
} from './auth.types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const existing = (await db.user.findFirst({
      where: { phone: contact },
      select: { id: true, account_status: true },
    })) as { id: string; account_status: string } | null;
    if (existing) {
      if (existing.account_status === 'active') {
        throw new AppError(
          ErrorCode.PHONE_ALREADY_REGISTERED,
          'An account with this phone number already exists.',
        );
      }
      // Pending registration exists — reuse it, generate a fresh OTP and resend
      const cfg = config();
      const otp = await generateOtp(existing.id, contactType);
      await queueOtpSms(contact, otp, existing.id);
      return {
        registration_id: existing.id,
        contact_type: contactType,
        otp_expires_at: new Date(Date.now() + cfg.otpTtlSeconds * 1000),
      };
    }
  } else {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const existing = (await db.user.findFirst({
      where: { email: contact },
      select: { id: true, account_status: true },
    })) as { id: string; account_status: string } | null;
    if (existing) {
      if (existing.account_status === 'active') {
        throw new AppError(
          ErrorCode.EMAIL_ALREADY_REGISTERED,
          'An account with this email address already exists.',
        );
      }
      // Pending registration exists — reuse it, generate a fresh OTP and resend
      const cfg = config();
      const otp = await generateOtp(existing.id, contactType);
      await queueOtpEmail(contact, otp, 'Verify your email address', existing.id);
      return {
        registration_id: existing.id,
        contact_type: contactType,
        otp_expires_at: new Date(Date.now() + cfg.otpTtlSeconds * 1000),
      };
    }
  }

  // Create pending user
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
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

  // Queue OTP delivery — worker handles SMTP/SMS with retries + dev fallback
  const cfg = config();
  if (contactType === 'email') {
    await queueOtpEmail(contact, otp, 'Verify your email address', userId);
  } else {
    await queueOtpSms(contact, otp, userId);
  }

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
  simforgeBypass = false,
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
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

  await verifyOtp(userId, contactType, otp, simforgeBypass);

  // Mark OTP as verified
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
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
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
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
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
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

  if (typedUser.registration_step === 'active') {
    throw new AppError(
      ErrorCode.CONFLICT,
      'This account has already been registered. Please log in.',
    );
  }

  if (typedUser.registration_step === 'otp_pending') {
    throw new AppError(
      ErrorCode.CONFLICT,
      'Please verify your OTP before completing registration.',
    );
  }

  if (typedUser.registration_step !== 'otp_verified') {
    throw new AppError(
      ErrorCode.CONFLICT,
      'Invalid registration state. Please start registration again.',
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
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      db.user.findUnique({ where: { universal_id: id }, select: { id: true } }),
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      db.universalIdHistory.findUnique({ where: { universal_id: id }, select: { id: true } }),
    ]);
    return activeUser !== null || history !== null;
  });

  const passcodeHash = await hashValue(payload.login_passcode);
  const username = payload.username.toLowerCase();

  // Atomic activation
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const activated = await db.$transaction(async (tx: Record<string, unknown>) => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const txDb = tx as any;

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
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

    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    await txDb.userAuth.update({
      where: { user_id: payload.registration_id },
      data: { login_passcode_hash: passcodeHash, argon2_params: argon2ParamsJson() },
    });

    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    await txDb.wallet.create({ data: { user_id: payload.registration_id } });
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    await txDb.notificationPref.create({ data: { user_id: payload.registration_id } });
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
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
    authEventsTotal.inc({ event: 'registration_completed' });
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

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
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
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
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
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
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
// Passcode unlock (screen-lock re-authentication)
// ---------------------------------------------------------------------------

/**
 * Re-authenticate using only the passcode when the app screen-locks a session.
 *
 * Flow:
 *   1. Validate refresh token → confirm session is live on this device
 *   2. Verify passcode against that user's hash (full lockout check applies)
 *   3. Rotate the refresh token and re-issue an access token
 *
 * This does NOT require contact type or OTP — the existing refresh token
 * proves the device. The passcode proves the user. Together they prove
 * "this person, on this device, right now."
 */
export async function unlockWithPasscode(payload: {
  rawRefreshToken: string;
  login_passcode: string;
  device_id: string;
  ip_address: string;
  user_agent: string;
}): Promise<AuthTokens> {
  const incomingHash = hashRefreshToken(payload.rawRefreshToken);

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const session = (await db.deviceSession.findUnique({
    where: { refresh_token: incomingHash },
    select: {
      id: true,
      user_id: true,
      device_id: true,
      is_revoked: true,
      expires_at: true,
    },
  })) as {
    id: string;
    user_id: string;
    device_id: string;
    is_revoked: boolean;
    expires_at: Date;
  } | null;

  if (!session) {
    throw new AppError(ErrorCode.SESSION_NOT_FOUND, 'Session not found. Please log in again.');
  }
  if (session.is_revoked) {
    throw new AppError(ErrorCode.SESSION_REVOKED, 'Session has been revoked. Please log in again.');
  }
  if (session.expires_at < new Date()) {
    throw new AppError(ErrorCode.TOKEN_EXPIRED, 'Session expired. Please log in again.');
  }

  const userId = session.user_id;

  // Load user + auth in one query
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const user = (await db.user.findUnique({
    where: { id: userId },
    select: {
      kyc_tier: true,
      account_status: true,
      auth: {
        select: {
          login_passcode_hash: true,
          login_passcode_failed_attempts: true,
          login_passcode_locked_until: true,
          login_passcode_hard_locked: true,
          login_passcode_lockout_count: true,
        },
      },
    },
  })) as {
    kyc_tier: number;
    account_status: string;
    auth: {
      login_passcode_hash: string | null;
      login_passcode_failed_attempts: number;
      login_passcode_locked_until: Date | null;
      login_passcode_hard_locked: boolean;
      login_passcode_lockout_count: number;
    } | null;
  } | null;

  if (!user || !user.auth?.login_passcode_hash) {
    throw new AppError(ErrorCode.NOT_FOUND, 'User not found.');
  }

  if (user.account_status === 'frozen') {
    throw new AppError(
      ErrorCode.ACCOUNT_FROZEN,
      'Your account has been frozen. Please contact support.',
    );
  }
  if (user.account_status !== 'active') {
    throw new AppError(ErrorCode.UNAUTHORIZED, 'Account is not active.');
  }

  const auth = user.auth;

  // Lockout check — same rules as login
  await assertNotLocked(userId, 'passcode', () =>
    Promise.resolve({
      hard_locked: auth.login_passcode_hard_locked,
      locked_until: auth.login_passcode_locked_until,
    }),
  );

  // Verify passcode
  const isValid = await verifyValue(auth.login_passcode_hash as string, payload.login_passcode);

  if (!isValid) {
    const lockout = await recordFailedAttempt(
      userId,
      'passcode',
      auth.login_passcode_failed_attempts,
      auth.login_passcode_lockout_count,
    );
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    await db.userAuth.update({
      where: { user_id: userId },
      data: {
        login_passcode_failed_attempts: lockout.newFailCount,
        login_passcode_locked_until: lockout.lockedUntil,
        login_passcode_hard_locked: lockout.hardLocked,
        login_passcode_lockout_count: lockout.newLockoutCount,
      },
    });

    // Hard lock reached — revoke this device session entirely.
    // The user must go through full login (contact + passcode) to regain access.
    // This prevents an attacker with a stolen device from brute-forcing the
    // lock screen indefinitely even after the passcode lockout kicks in.
    if (lockout.hardLocked) {
      await revokeSession(payload.rawRefreshToken);
      throw new AppError(
        ErrorCode.ACCOUNT_LOCKED,
        'Too many incorrect attempts. This session has been terminated for your security. Please log in again.',
      );
    }

    throw new AppError(ErrorCode.INVALID_CREDENTIALS, 'Incorrect passcode.');
  }

  // Passcode correct — clear lockout state
  const cleared = await clearLockout(userId, 'passcode');
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  await db.userAuth.update({
    where: { user_id: userId },
    data: {
      login_passcode_failed_attempts: cleared.newFailCount,
      login_passcode_locked_until: cleared.lockedUntil,
      login_passcode_hard_locked: cleared.hardLocked,
    },
  });

  // Rotate the existing session — same device, new token pair
  return rotateRefreshToken({
    rawRefreshToken: payload.rawRefreshToken,
    deviceId: payload.device_id,
    ipAddress: payload.ip_address,
    userAgent: payload.user_agent,
  });
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
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
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
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
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
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
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
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const user = await db.user.findUnique({
    where: whereClause,
    select: { id: true, account_status: true, email: true },
  });

  if (!user) throw new AppError(ErrorCode.NOT_FOUND, 'No account found with that contact.');
  const u = user as { id: string; account_status: string; email: string | null };
  if (u.account_status !== 'active')
    throw new AppError(ErrorCode.UNAUTHORIZED, 'Account is not active.');

  const otp = await generateOtp(u.id, contactType);

  // Queue OTP delivery — worker handles SMTP/SMS with retries + dev fallback
  if (contactType === 'email' && u.email) {
    await queueOtpEmail(u.email, otp, 'Reset your passcode', u.id);
  } else {
    await queueOtpSms(contact, otp, u.id);
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
  simforgeBypass?: boolean;
}): Promise<AuthTokens> {
  const userId = await validateResetToken(payload.reset_token);
  // Get the registration channel to know which OTP type to verify
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const userRecord = await db.user.findUniqueOrThrow({
    where: { id: userId },
    select: { registration_channel: true, kyc_tier: true },
  });
  const { registration_channel, kyc_tier } = userRecord as {
    registration_channel: string;
    kyc_tier: number;
  };

  await verifyOtp(
    userId,
    registration_channel as 'phone' | 'email',
    payload.otp,
    payload.simforgeBypass ?? false,
  );

  const newHash = await hashValue(payload.new_passcode);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
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

export async function setTransactionPin(userId: string, pin: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const auth = (await db.userAuth.findUnique({
    where: { user_id: userId },
    select: { transaction_pin_hash: true },
  })) as { transaction_pin_hash: string | null } | null;

  if (!auth) throw new AppError(ErrorCode.NOT_FOUND, 'User not found.');
  if (auth.transaction_pin_hash) {
    throw new AppError(ErrorCode.CONFLICT, 'PIN already set. Use the reset flow to change it.');
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  await db.userAuth.update({
    where: { user_id: userId },
    data: { transaction_pin_hash: await hashValue(pin) },
  });
}

export async function getTransactionPinStatus(userId: string): Promise<{ pin_set: boolean }> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const auth = (await db.userAuth.findUnique({
    where: { user_id: userId },
    select: { transaction_pin_hash: true },
  })) as { transaction_pin_hash: string | null } | null;

  return { pin_set: !!auth?.transaction_pin_hash };
}

// ---------------------------------------------------------------------------
// Transaction PIN reset — 3-step OTP flow
// ---------------------------------------------------------------------------

export async function initiatePinReset(
  userId: string,
): Promise<{ reset_token: string; expires_at: Date }> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const user = (await db.user.findUnique({
    where: { id: userId },
    select: { phone: true, email: true, registration_channel: true },
  })) as { phone: string | null; email: string | null; registration_channel: string | null } | null;

  if (!user) throw new AppError(ErrorCode.NOT_FOUND, 'User not found.');

  const contactType = (user.registration_channel ?? 'phone') as 'phone' | 'email';
  const contact = contactType === 'phone' ? user.phone : user.email;

  if (!contact) throw new AppError(ErrorCode.NOT_FOUND, 'No contact on file to send OTP.');

  const otp = await generateOtp(userId, contactType);
  const resetToken = require('crypto').randomBytes(32).toString('hex') as string;

  await redis.set(`pin_reset_token:${resetToken}`, userId, 'EX', 15 * 60);

  if (contactType === 'phone') {
    await queueOtpSms(contact, otp, userId);
  } else {
    await queueOtpEmail(contact, otp, 'Reset your PIN', userId);
  }

  return { reset_token: resetToken, expires_at: new Date(Date.now() + 15 * 60 * 1000) };
}

export async function confirmPinResetOtp(params: {
  reset_token: string;
  otp: string;
  simforgeBypass?: boolean;
}): Promise<{ confirm_token: string; expires_at: Date }> {
  const userId = await redis.get(`pin_reset_token:${params.reset_token}`);
  if (!userId) {
    throw new AppError(
      ErrorCode.INVALID_TOKEN,
      'Reset token is invalid or has expired. Please start again.',
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const user = (await db.user.findUnique({
    where: { id: userId },
    select: { registration_channel: true },
  })) as { registration_channel: string | null } | null;

  if (!user) throw new AppError(ErrorCode.NOT_FOUND, 'User not found.');

  const contactType = (user.registration_channel ?? 'phone') as 'phone' | 'email';

  await verifyOtp(userId, contactType, params.otp, params.simforgeBypass ?? false);

  await redis.del(`pin_reset_token:${params.reset_token}`);

  const confirmToken = require('crypto').randomBytes(32).toString('hex') as string;
  await redis.set(`pin_confirm_token:${confirmToken}`, userId, 'EX', 10 * 60);

  return { confirm_token: confirmToken, expires_at: new Date(Date.now() + 10 * 60 * 1000) };
}

export async function completePinReset(params: {
  confirm_token: string;
  new_pin: string;
}): Promise<void> {
  const userId = await redis.get(`pin_confirm_token:${params.confirm_token}`);
  if (!userId) {
    throw new AppError(
      ErrorCode.INVALID_TOKEN,
      'Confirmation token is invalid or has expired. Please start again.',
    );
  }

  await redis.del(`pin_confirm_token:${params.confirm_token}`);

  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  await db.userAuth.update({
    where: { user_id: userId },
    data: {
      transaction_pin_hash: await hashValue(params.new_pin),
      transaction_pin_failed_attempts: 0,
      transaction_pin_locked_until: null,
      transaction_pin_hard_locked: false,
      transaction_pin_lockout_count: 0,
    },
  });
}

export async function verifyTransactionPin(userId: string, pin: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
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
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
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
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
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

export async function setUpp(userId: string, upp: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const auth = (await db.userAuth.findUnique({
    where: { user_id: userId },
    select: { upp_hash: true },
  })) as { upp_hash: string | null } | null;

  if (!auth) throw new AppError(ErrorCode.NOT_FOUND, 'User not found.');
  if (auth.upp_hash) {
    throw new AppError(
      ErrorCode.CONFLICT,
      'Universal Payment PIN already set. Use the reset flow to change it.',
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  await db.userAuth.update({
    where: { user_id: userId },
    data: { upp_hash: await hashValue(upp) },
  });
}

// ---------------------------------------------------------------------------
// UPP reset — 3-step OTP flow (mirrors PIN reset)
// ---------------------------------------------------------------------------

export async function getUppStatus(userId: string): Promise<{ upp_set: boolean }> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const auth = (await db.userAuth.findUnique({
    where: { user_id: userId },
    select: { upp_hash: true },
  })) as { upp_hash: string | null } | null;

  return { upp_set: !!auth?.upp_hash };
}

export async function initiateUppReset(
  userId: string,
): Promise<{ reset_token: string; expires_at: Date }> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const user = (await db.user.findUnique({
    where: { id: userId },
    select: { phone: true, email: true, registration_channel: true },
  })) as { phone: string | null; email: string | null; registration_channel: string | null } | null;

  if (!user) throw new AppError(ErrorCode.NOT_FOUND, 'User not found.');

  const contactType = (user.registration_channel ?? 'phone') as 'phone' | 'email';
  const contact = contactType === 'phone' ? user.phone : user.email;

  if (!contact) throw new AppError(ErrorCode.NOT_FOUND, 'No contact on file to send OTP.');

  const otp = await generateOtp(userId, contactType);
  const resetToken = require('crypto').randomBytes(32).toString('hex') as string;

  await redis.set(`upp_reset_token:${resetToken}`, userId, 'EX', 15 * 60);

  if (contactType === 'phone') {
    await queueOtpSms(contact, otp, userId);
  } else {
    await queueOtpEmail(contact, otp, 'Reset your passcode', userId);
  }

  return { reset_token: resetToken, expires_at: new Date(Date.now() + 15 * 60 * 1000) };
}

export async function confirmUppResetOtp(params: {
  reset_token: string;
  otp: string;
  simforgeBypass?: boolean;
}): Promise<{ confirm_token: string; expires_at: Date }> {
  const userId = await redis.get(`upp_reset_token:${params.reset_token}`);
  if (!userId) {
    throw new AppError(
      ErrorCode.INVALID_TOKEN,
      'Reset token is invalid or has expired. Please start again.',
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const user = (await db.user.findUnique({
    where: { id: userId },
    select: { registration_channel: true },
  })) as { registration_channel: string | null } | null;

  if (!user) throw new AppError(ErrorCode.NOT_FOUND, 'User not found.');

  const contactType = (user.registration_channel ?? 'phone') as 'phone' | 'email';

  await verifyOtp(userId, contactType, params.otp, params.simforgeBypass ?? false);

  await redis.del(`upp_reset_token:${params.reset_token}`);

  const confirmToken = require('crypto').randomBytes(32).toString('hex') as string;
  await redis.set(`upp_confirm_token:${confirmToken}`, userId, 'EX', 10 * 60);

  return { confirm_token: confirmToken, expires_at: new Date(Date.now() + 10 * 60 * 1000) };
}

export async function completeUppReset(params: {
  confirm_token: string;
  new_upp: string;
}): Promise<void> {
  const userId = await redis.get(`upp_confirm_token:${params.confirm_token}`);
  if (!userId) {
    throw new AppError(
      ErrorCode.INVALID_TOKEN,
      'Confirmation token is invalid or has expired. Please start again.',
    );
  }

  await redis.del(`upp_confirm_token:${params.confirm_token}`);

  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  await db.userAuth.update({
    where: { user_id: userId },
    data: {
      upp_hash: await hashValue(params.new_upp),
      upp_failed_attempts: 0,
      upp_locked_until: null,
      upp_hard_locked: false,
      upp_lockout_count: 0,
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
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
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
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      db.user.findUnique({ where: { universal_id: id }, select: { id: true } }),
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      db.universalIdHistory.findUnique({ where: { universal_id: id }, select: { id: true } }),
    ]);
    return active !== null || hist !== null;
  });

  const now = new Date();
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  await db.$transaction([
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    db.universalIdHistory.create({
      data: { user_id: userId, universal_id: u.universal_id, revoked_at: now },
    }),
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
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
