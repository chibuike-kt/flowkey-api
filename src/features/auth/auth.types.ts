/**
 * FlowKey — Auth Feature Types
 */

// ---------------------------------------------------------------------------
// Request payloads
// ---------------------------------------------------------------------------

export interface RegisterPayload {
  phone: string;
  email: string;
  display_name: string;
  login_passcode: string;
  device_id: string;
  fcm_token: string;
}

export interface VerifyOtpPayload {
  user_id: string;
  otp: string;
}

export interface ResendOtpPayload {
  user_id: string;
}

export interface LoginPayload {
  phone: string;
  login_passcode: string;
  device_id: string;
  fcm_token: string;
}

export interface RefreshTokenPayload {
  refresh_token: string;
  device_id: string;
}

export interface LogoutPayload {
  refresh_token: string;
}

// ---------------------------------------------------------------------------
// JWT payloads
// ---------------------------------------------------------------------------

export interface AccessTokenPayload {
  sub: string; // user_id
  session_id: string;
  device_id: string;
  tier: number;
  iat: number;
  exp: number;
  iss: string;
  aud: string | string[];
}

export interface AdminAccessTokenPayload {
  sub: string; // admin_id
  session_id: string;
  device_id: string;
  role: 'admin' | 'super_admin';
  iat: number;
  exp: number;
  iss: string;
  aud: string | string[];
}

// ---------------------------------------------------------------------------
// Service responses
// ---------------------------------------------------------------------------

export interface AuthTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

export interface RegisterResult {
  user_id: string;
  phone_otp_expires_at: Date;
  email_otp_expires_at: Date;
}

export interface VerifyEmailResult {
  email_verified: boolean;
  account_active: boolean;
  tokens: AuthTokens | null;
  user: UserProfileResult | null;
}

export interface UserProfileResult {
  id: string;
  phone: string;
  email: string;
  display_name: string;
  universal_id: string;
  kyc_tier: number;
  account_status: string;
  has_transaction_pin: boolean;
  created_at: Date;
}

export interface LoginResult {
  tokens: AuthTokens;
  user: UserProfileResult;
}

// ---------------------------------------------------------------------------
// OTP types
// ---------------------------------------------------------------------------

export type OtpType = 'phone' | 'email';
