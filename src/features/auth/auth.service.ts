/**
 * FlowKey — Auth Service
 *
 * Core authentication business logic:
 *   - Registration with OTP verification
 *   - Login with progressive lockout
 *   - Account activation (wallet + Universal ID creation)
 *   - Passcode and PIN management
 *
 * This service owns auth decisions. It never touches HTTP — that is
 * the controller's responsibility.
 */

import * as argon2 from 'argon2';
import { config } from '../../config';
import { prisma } from '../../common/utils/prisma';
import { AppError, ErrorCode } from '../errors/AppError';
import { logger } from '../../common/utils/logger';
import { generateOtp, verifyOtp, resendOtp, getOtpTtl } from './otp.service';
import { createSession, revokeOtherSessions } from './session.service';
import { assertNotLocked, recordFailedAttempt, clearLockout } from './lockout.service';
import { generateUniversalId } from '../universal-id/universal-id.service';
import type {
  RegisterResult,
  VerifyEmailResult,
  LoginResult,
  UserProfileResult,
  AuthTokens,
} from './auth.types';

// ---------------------------------------------------------------------------
// Argon2id helpers
// ---------------------------------------------------------------------------

function getArgon2Options(): argon2.Options & { raw?: false } {
  const cfg = config();
  return {
    type: argon2.argon2id,
    memoryCost: cfg.argon2MemoryCost,
    timeCost: cfg.argon2TimeCost,
    parallelism: cfg.argon2Parallelism,
    hashLength: cfg.argon2OutputLength,
  };
}

function buildArgon2ParamsJson(): string {
  const cfg = config();
  return JSON.stringify({
    m: cfg.argon2MemoryCost,
    t: cfg.argon2TimeCost,
    p: cfg.argon2Parallelism,
    l: cfg.argon2OutputLength,
  });
}

async function hashSecret(value: string): Promise<string> {
  return argon2.hash(value, getArgon2Options());
}

async function verifySecret(hash: string, value: string): Promise<boolean> {
  return argon2.verify(hash, value);
}

// ---------------------------------------------------------------------------
// DB helpers (typed wrappers around the untyped Prisma client)
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * Register a new user.
 * Creates a pending user record and sends both phone and email OTPs.
 * No wallet, no Universal ID yet — those are created on account activation.
 */
export async function register(payload: {
  phone: string;
  email: string;
  display_name: string;
  login_passcode: string;
}): Promise<RegisterResult> {
  // Check uniqueness — timing-safe: both checks always run
  const [existingPhone, existingEmail] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    db.user.findUnique({ where: { phone: payload.phone }, select: { id: true } }),
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    db.user.findUnique({ where: { email: payload.email }, select: { id: true } }),
  ]);

  if (existingPhone) {
    throw new AppError(
      ErrorCode.PHONE_ALREADY_REGISTERED,
      'An account with this phone number already exists.',
    );
  }

  if (existingEmail) {
    throw new AppError(
      ErrorCode.EMAIL_ALREADY_REGISTERED,
      'An account with this email address already exists.',
    );
  }

  const passcodeHash = await hashSecret(payload.login_passcode);
  const argon2Params = buildArgon2ParamsJson();

  // Create pending user with auth record
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const user = await db.user.create({
    data: {
      phone: payload.phone,
      email: payload.email,
      display_name: payload.display_name,
      // Temporary placeholder — real Universal ID assigned on account activation
      universal_id: `PENDING-${Date.now()}`,
      account_status: 'pending_verification',
      auth: {
        create: {
          login_passcode_hash: passcodeHash,
          argon2_params: argon2Params,
        },
      },
    },
    select: { id: true },
  });

  const userId = (user as { id: string }).id;

  // Generate and store OTPs
  const [phoneOtp, emailOtp] = await Promise.all([
    generateOtp(userId, 'phone'),
    generateOtp(userId, 'email'),
  ]);

  // OTPs are logged at debug level — never at info or above (would appear in prod logs)
  logger.debug('OTPs generated for registration', {
    userId,
    // In production, these would be sent via SMS/email — never logged
    ...(config().isDevelopment ? { phoneOtp, emailOtp } : {}),
  });

  const cfg = config();
  const otpExpiresAt = new Date(Date.now() + cfg.otpTtlSeconds * 1000);

  // TODO Phase 14: queue SMS and email delivery jobs via BullMQ
  // notificationQueue.add('send-otp', { userId, type: 'phone', otp: phoneOtp })
  // notificationQueue.add('send-otp', { userId, type: 'email', otp: emailOtp })

  return {
    user_id: userId,
    phone_otp_expires_at: otpExpiresAt,
    email_otp_expires_at: otpExpiresAt,
  };
}

// ---------------------------------------------------------------------------
// OTP verification
// ---------------------------------------------------------------------------

/**
 * Verify phone OTP.
 * Marks the phone as verified in Redis.
 */
export async function verifyPhoneOtp(userId: string, otp: string): Promise<void> {
  // Assert user exists and is pending verification
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, account_status: true },
  });

  if (!user) {
    throw new AppError(ErrorCode.NOT_FOUND, 'User not found.');
  }

  await verifyOtp(userId, 'phone', otp);

  // Mark phone as verified in Redis
  await markVerified(userId, 'phone');
}

/**
 * Verify email OTP.
 * If phone is already verified, activates the account atomically.
 */
export async function verifyEmailOtp(
  userId: string,
  otp: string,
  deviceId: string,
  ipAddress: string,
  userAgent: string,
  fcmToken: string,
): Promise<VerifyEmailResult> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, account_status: true, phone: true, email: true, display_name: true },
  });

  if (!user) {
    throw new AppError(ErrorCode.NOT_FOUND, 'User not found.');
  }

  await verifyOtp(userId, 'email', otp);
  await markVerified(userId, 'email');

  const phoneVerified = await isVerified(userId, 'phone');

  if (!phoneVerified) {
    return { email_verified: true, account_active: false, tokens: null, user: null };
  }

  // Both verified — activate account
  const result = await activateAccount(userId, {
    deviceId,
    ipAddress,
    userAgent,
    fcmToken,
  });

  return { email_verified: true, account_active: true, ...result };
}

// ---------------------------------------------------------------------------
// Account activation
// ---------------------------------------------------------------------------

/**
 * Activate a user account atomically.
 * Creates wallet, assigns Universal ID, creates NotificationPref,
 * writes genesis AuditLog entry — all in a single DB transaction.
 */
async function activateAccount(
  userId: string,
  sessionParams: {
    deviceId: string;
    ipAddress: string;
    userAgent: string;
    fcmToken: string;
  },
): Promise<{ tokens: AuthTokens; user: UserProfileResult }> {
  // Generate Universal ID before the transaction to keep the transaction tight
  const universalId = await generateUniversalId(async (id) => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const existing = await db.user.findUnique({
      where: { universal_id: id },
      select: { id: true },
    });
    return existing !== null;
  });

  // Atomic activation transaction
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const activated = await db.$transaction(async (tx: Record<string, unknown>) => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const txDb = tx as any;

    // Update user status and assign Universal ID
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const updatedUser = await txDb.user.update({
      where: { id: userId },
      data: {
        account_status: 'active',
        universal_id: universalId,
      },
      select: {
        id: true,
        phone: true,
        email: true,
        display_name: true,
        universal_id: true,
        kyc_tier: true,
        account_status: true,
        created_at: true,
      },
    });

    // Create wallet
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    await txDb.wallet.create({ data: { user_id: userId } });

    // Create notification preferences with defaults
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    await txDb.notificationPref.create({ data: { user_id: userId } });

    // Write genesis audit log entry (hash chain origin for this user's events)
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    await txDb.auditLog.create({
      data: {
        actor_id: userId,
        actor_type: 'user',
        action: 'user.account_activated',
        target_type: 'user',
        target_id: userId,
        previous_hash: 'GENESIS',
        metadata: { universal_id: universalId },
      },
    });

    return updatedUser as {
      id: string;
      phone: string;
      email: string;
      display_name: string;
      universal_id: string;
      kyc_tier: number;
      account_status: string;
      created_at: Date;
    };
  });

  // Create session (outside the transaction — session failure shouldn't roll back activation)
  const tokens = await createSession({
    userId,
    deviceId: sessionParams.deviceId,
    ipAddress: sessionParams.ipAddress,
    userAgent: sessionParams.userAgent,
    fcmToken: sessionParams.fcmToken,
    kyc_tier: activated.kyc_tier,
  });

  // Clean up verification flags from Redis
  await clearVerificationFlags(userId);

  const userProfile: UserProfileResult = {
    id: activated.id,
    phone: activated.phone,
    email: activated.email,
    display_name: activated.display_name,
    universal_id: activated.universal_id,
    kyc_tier: activated.kyc_tier,
    account_status: activated.account_status,
    has_transaction_pin: false,
    created_at: activated.created_at,
  };

  return { tokens, user: userProfile };
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

/**
 * Authenticate a user with phone + passcode.
 * Enforces lockout, issues session on success.
 */
export async function login(payload: {
  phone: string;
  login_passcode: string;
  device_id: string;
  fcm_token: string;
  ip_address: string;
  user_agent: string;
}): Promise<LoginResult> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const user = await db.user.findUnique({
    where: { phone: payload.phone },
    select: {
      id: true,
      phone: true,
      email: true,
      display_name: true,
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
        },
      },
    },
  });

  // Always hash even if user not found — prevents timing-based user enumeration
  const dummyHash =
    '$argon2id$v=19$m=65536,t=3,p=4$dummysaltdummysalt$dummyhashdummyhashdummyhashdummy';

  const passcodeHash =
    user !== null
      ? (user as { auth: { login_passcode_hash: string } }).auth.login_passcode_hash
      : dummyHash;

  // Check lockout before verifying passcode (fast fail)
  if (user !== null) {
    const typedUser = user as {
      id: string;
      account_status: string;
      auth: {
        login_passcode_locked_until: Date | null;
        login_passcode_hard_locked: boolean;
        login_passcode_failed_attempts: number;
        login_passcode_lockout_count: number;
        transaction_pin_hash: string | null;
      };
    };

    if (typedUser.account_status === 'frozen') {
      throw new AppError(
        ErrorCode.ACCOUNT_FROZEN,
        'Your account has been frozen. Please contact support.',
      );
    }

    if (typedUser.account_status !== 'active') {
      throw new AppError(ErrorCode.UNAUTHORIZED, 'This account is not active.');
    }

    await assertNotLocked(typedUser.id, 'passcode', () =>
      Promise.resolve({
        hard_locked: typedUser.auth.login_passcode_hard_locked,
        locked_until: typedUser.auth.login_passcode_locked_until,
      }),
    );
  }

  const isValid = await verifySecret(passcodeHash, payload.login_passcode);

  if (!isValid || user === null) {
    // Record failed attempt if user exists
    if (user !== null) {
      const typedUser = user as {
        id: string;
        auth: {
          login_passcode_failed_attempts: number;
          login_passcode_lockout_count: number;
        };
      };

      const lockoutState = await recordFailedAttempt(
        typedUser.id,
        'passcode',
        typedUser.auth.login_passcode_failed_attempts,
        typedUser.auth.login_passcode_lockout_count,
      );

      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      await db.userAuth.update({
        where: { user_id: typedUser.id },
        data: {
          login_passcode_failed_attempts: lockoutState.newFailCount,
          login_passcode_locked_until: lockoutState.lockedUntil,
          login_passcode_hard_locked: lockoutState.hardLocked,
          login_passcode_lockout_count: lockoutState.newLockoutCount,
        },
      });
    }

    throw new AppError(ErrorCode.INVALID_CREDENTIALS, 'Incorrect phone number or passcode.');
  }

  const typedUser = user as {
    id: string;
    phone: string;
    email: string;
    display_name: string;
    universal_id: string;
    kyc_tier: number;
    account_status: string;
    created_at: Date;
    auth: {
      transaction_pin_hash: string | null;
      login_passcode_failed_attempts: number;
      login_passcode_lockout_count: number;
    };
  };

  // Clear lockout on successful login
  const cleared = await clearLockout(typedUser.id, 'passcode');
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  await db.userAuth.update({
    where: { user_id: typedUser.id },
    data: {
      login_passcode_failed_attempts: cleared.newFailCount,
      login_passcode_locked_until: cleared.lockedUntil,
      login_passcode_hard_locked: cleared.hardLocked,
    },
  });

  const tokens = await createSession({
    userId: typedUser.id,
    deviceId: payload.device_id,
    ipAddress: payload.ip_address,
    userAgent: payload.user_agent,
    fcmToken: payload.fcm_token,
    kyc_tier: typedUser.kyc_tier,
  });

  const userProfile: UserProfileResult = {
    id: typedUser.id,
    phone: typedUser.phone,
    email: typedUser.email,
    display_name: typedUser.display_name,
    universal_id: typedUser.universal_id,
    kyc_tier: typedUser.kyc_tier,
    account_status: typedUser.account_status,
    has_transaction_pin: typedUser.auth.transaction_pin_hash !== null,
    created_at: typedUser.created_at,
  };

  return { tokens, user: userProfile };
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

  if (!auth) {
    throw new AppError(ErrorCode.NOT_FOUND, 'User auth record not found.');
  }

  const typedAuth = auth as {
    login_passcode_hash: string;
    login_passcode_hard_locked: boolean;
    login_passcode_locked_until: Date | null;
    login_passcode_failed_attempts: number;
    login_passcode_lockout_count: number;
  };

  await assertNotLocked(userId, 'passcode', () =>
    Promise.resolve({
      hard_locked: typedAuth.login_passcode_hard_locked,
      locked_until: typedAuth.login_passcode_locked_until,
    }),
  );

  const isValid = await verifySecret(typedAuth.login_passcode_hash, currentPasscode);

  if (!isValid) {
    const lockoutState = await recordFailedAttempt(
      userId,
      'passcode',
      typedAuth.login_passcode_failed_attempts,
      typedAuth.login_passcode_lockout_count,
    );

    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    await db.userAuth.update({
      where: { user_id: userId },
      data: {
        login_passcode_failed_attempts: lockoutState.newFailCount,
        login_passcode_locked_until: lockoutState.lockedUntil,
        login_passcode_hard_locked: lockoutState.hardLocked,
        login_passcode_lockout_count: lockoutState.newLockoutCount,
      },
    });

    throw new AppError(ErrorCode.INVALID_CREDENTIALS, 'Current passcode is incorrect.');
  }

  const newHash = await hashSecret(newPasscode);

  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  await db.userAuth.update({
    where: { user_id: userId },
    data: {
      login_passcode_hash: newHash,
      login_passcode_failed_attempts: 0,
      login_passcode_locked_until: null,
      login_passcode_hard_locked: false,
      argon2_params: buildArgon2ParamsJson(),
    },
  });

  const sessionsRevoked = await revokeOtherSessions(userId, sessionId);

  return { sessions_revoked: sessionsRevoked };
}

// ---------------------------------------------------------------------------
// Transaction PIN management
// ---------------------------------------------------------------------------

export async function setTransactionPin(
  userId: string,
  loginPasscode: string,
  newPin: string,
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const auth = await db.userAuth.findUnique({
    where: { user_id: userId },
    select: {
      login_passcode_hash: true,
      login_passcode_hard_locked: true,
      login_passcode_locked_until: true,
      transaction_pin_hash: true,
    },
  });

  if (!auth) throw new AppError(ErrorCode.NOT_FOUND, 'User not found.');

  const typedAuth = auth as {
    login_passcode_hash: string;
    login_passcode_hard_locked: boolean;
    login_passcode_locked_until: Date | null;
    transaction_pin_hash: string | null;
  };

  if (typedAuth.transaction_pin_hash !== null) {
    throw new AppError(
      ErrorCode.CONFLICT,
      'Transaction PIN is already set. Use change PIN to update it.',
    );
  }

  const isValid = await verifySecret(typedAuth.login_passcode_hash, loginPasscode);
  if (!isValid) {
    throw new AppError(ErrorCode.INVALID_CREDENTIALS, 'Login passcode is incorrect.');
  }

  const pinHash = await hashSecret(newPin);

  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  await db.userAuth.update({
    where: { user_id: userId },
    data: {
      transaction_pin_hash: pinHash,
      transaction_pin_failed_attempts: 0,
      transaction_pin_locked_until: null,
      transaction_pin_hard_locked: false,
    },
  });
}

export async function changeTransactionPin(
  userId: string,
  currentPin: string,
  newPin: string,
): Promise<void> {
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

  const typedAuth = auth as {
    transaction_pin_hash: string | null;
    transaction_pin_failed_attempts: number;
    transaction_pin_locked_until: Date | null;
    transaction_pin_hard_locked: boolean;
    transaction_pin_lockout_count: number;
  };

  if (!typedAuth.transaction_pin_hash) {
    throw new AppError(ErrorCode.NOT_FOUND, 'No transaction PIN is set. Use set PIN first.');
  }

  await assertNotLocked(userId, 'pin', () =>
    Promise.resolve({
      hard_locked: typedAuth.transaction_pin_hard_locked,
      locked_until: typedAuth.transaction_pin_locked_until,
    }),
  );

  const isValid = await verifySecret(typedAuth.transaction_pin_hash, currentPin);

  if (!isValid) {
    const lockoutState = await recordFailedAttempt(
      userId,
      'pin',
      typedAuth.transaction_pin_failed_attempts,
      typedAuth.transaction_pin_lockout_count,
    );

    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    await db.userAuth.update({
      where: { user_id: userId },
      data: {
        transaction_pin_failed_attempts: lockoutState.newFailCount,
        transaction_pin_locked_until: lockoutState.lockedUntil,
        transaction_pin_hard_locked: lockoutState.hardLocked,
        transaction_pin_lockout_count: lockoutState.newLockoutCount,
      },
    });

    throw new AppError(ErrorCode.INVALID_CREDENTIALS, 'Current PIN is incorrect.');
  }

  const newHash = await hashSecret(newPin);

  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  await db.userAuth.update({
    where: { user_id: userId },
    data: {
      transaction_pin_hash: newHash,
      transaction_pin_failed_attempts: 0,
      transaction_pin_locked_until: null,
      transaction_pin_hard_locked: false,
    },
  });
}

export async function deleteTransactionPin(userId: string, loginPasscode: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const auth = await db.userAuth.findUnique({
    where: { user_id: userId },
    select: { login_passcode_hash: true, transaction_pin_hash: true },
  });

  if (!auth) throw new AppError(ErrorCode.NOT_FOUND, 'User not found.');

  const typedAuth = auth as {
    login_passcode_hash: string;
    transaction_pin_hash: string | null;
  };

  const isValid = await verifySecret(typedAuth.login_passcode_hash, loginPasscode);
  if (!isValid) {
    throw new AppError(ErrorCode.INVALID_CREDENTIALS, 'Login passcode is incorrect.');
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
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

/**
 * Verify a transaction PIN during payment flows.
 * Records failures and enforces lockout.
 * Returns true on success — callers should not proceed if this throws.
 */
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

  const typedAuth = auth as {
    transaction_pin_hash: string | null;
    transaction_pin_failed_attempts: number;
    transaction_pin_locked_until: Date | null;
    transaction_pin_hard_locked: boolean;
    transaction_pin_lockout_count: number;
  };

  if (!typedAuth.transaction_pin_hash) {
    throw new AppError(
      ErrorCode.NOT_FOUND,
      'Transaction PIN not set. Please set your PIN before making transfers.',
    );
  }

  await assertNotLocked(userId, 'pin', () =>
    Promise.resolve({
      hard_locked: typedAuth.transaction_pin_hard_locked,
      locked_until: typedAuth.transaction_pin_locked_until,
    }),
  );

  const isValid = await verifySecret(typedAuth.transaction_pin_hash, pin);

  if (!isValid) {
    const lockoutState = await recordFailedAttempt(
      userId,
      'pin',
      typedAuth.transaction_pin_failed_attempts,
      typedAuth.transaction_pin_lockout_count,
    );

    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    await db.userAuth.update({
      where: { user_id: userId },
      data: {
        transaction_pin_failed_attempts: lockoutState.newFailCount,
        transaction_pin_locked_until: lockoutState.lockedUntil,
        transaction_pin_hard_locked: lockoutState.hardLocked,
        transaction_pin_lockout_count: lockoutState.newLockoutCount,
      },
    });

    throw new AppError(ErrorCode.INVALID_CREDENTIALS, 'Incorrect PIN.');
  }

  // Clear lockout on success
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
// Passcode recovery
// ---------------------------------------------------------------------------

export async function initiateForgotPasscode(
  phone: string,
): Promise<{ reset_token: string; expires_at: Date }> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const user = await db.user.findUnique({
    where: { phone },
    select: { id: true, account_status: true },
  });

  if (!user) {
    throw new AppError(ErrorCode.NOT_FOUND, 'No account found with that phone number.');
  }

  const typedUser = user as { id: string; account_status: string };

  if (typedUser.account_status !== 'active') {
    throw new AppError(ErrorCode.UNAUTHORIZED, 'This account is not active.');
  }

  // Generate recovery OTPs for both channels
  const [phoneOtp, emailOtp] = await Promise.all([
    generateOtp(typedUser.id, 'phone'),
    generateOtp(typedUser.id, 'email'),
  ]);

  logger.debug('Recovery OTPs generated', {
    userId: typedUser.id,
    ...(config().isDevelopment ? { phoneOtp, emailOtp } : {}),
  });

  // Generate a short-lived reset token (15 min)
  const resetToken = await generateResetToken(typedUser.id);
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

  // TODO Phase 14: queue SMS and email OTP delivery
  return { reset_token: resetToken, expires_at: expiresAt };
}

export async function resetPasscode(payload: {
  reset_token: string;
  phone_otp: string;
  email_otp: string;
  new_passcode: string;
  device_id: string;
  ip_address: string;
  user_agent: string;
  fcm_token: string;
}): Promise<AuthTokens> {
  const userId = await validateResetToken(payload.reset_token);

  // Verify both OTPs — both must pass
  await verifyOtp(userId, 'phone', payload.phone_otp);
  await verifyOtp(userId, 'email', payload.email_otp);

  const newHash = await hashSecret(payload.new_passcode);

  // Revoke all sessions and update passcode
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  await db.userAuth.update({
    where: { user_id: userId },
    data: {
      login_passcode_hash: newHash,
      login_passcode_failed_attempts: 0,
      login_passcode_locked_until: null,
      login_passcode_hard_locked: false,
      login_passcode_lockout_count: 0,
      argon2_params: buildArgon2ParamsJson(),
    },
  });

  // Revoke all existing sessions
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  await db.deviceSession.updateMany({
    where: { user_id: userId },
    data: { is_revoked: true },
  });

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const user = await db.user.findUniqueOrThrow({
    where: { id: userId },
    select: { kyc_tier: true },
  });

  const tokens = await createSession({
    userId,
    deviceId: payload.device_id,
    ipAddress: payload.ip_address,
    userAgent: payload.user_agent,
    fcmToken: payload.fcm_token,
    kyc_tier: (user as { kyc_tier: number }).kyc_tier,
  });

  await invalidateResetToken(payload.reset_token);

  return tokens;
}

// ---------------------------------------------------------------------------
// Reset token helpers (Redis-backed, 15-min TTL)
// ---------------------------------------------------------------------------

async function generateResetToken(userId: string): Promise<string> {
  const { randomBytes } = await import('crypto');
  const token = randomBytes(32).toString('hex');
  const key = `reset_token:${token}`;
  await redis.set(key, userId, 'EX', 15 * 60);
  return token;
}

async function validateResetToken(token: string): Promise<string> {
  const key = `reset_token:${token}`;
  const userId = await redis.get(key);
  if (!userId) {
    throw new AppError(
      ErrorCode.VALIDATION_ERROR,
      'Reset token is invalid or has expired. Please start the recovery process again.',
    );
  }
  return userId;
}

async function invalidateResetToken(token: string): Promise<void> {
  await redis.del(`reset_token:${token}`);
}

// ---------------------------------------------------------------------------
// Verification flag helpers (Redis — tracks which channels are verified)
// ---------------------------------------------------------------------------

async function markVerified(userId: string, type: 'phone' | 'email'): Promise<void> {
  const cfg = config();
  await redis.set(`verified:${userId}:${type}`, '1', 'EX', cfg.otpTtlSeconds * 10);
}

async function isVerified(userId: string, type: 'phone' | 'email'): Promise<boolean> {
  const val = await redis.get(`verified:${userId}:${type}`);
  return val === '1';
}

async function clearVerificationFlags(userId: string): Promise<void> {
  await redis.del(`verified:${userId}:phone`, `verified:${userId}:email`);
}

// ---------------------------------------------------------------------------
// Import redis here to avoid circular dependency
// ---------------------------------------------------------------------------

import { redis } from '../../common/utils/redis';
