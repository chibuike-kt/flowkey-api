/**
 * FlowKey — Auth Feature Types
 */

export interface InitiateRegistrationPayload {
  contact: string; // phone number OR email address
  contact_type: 'phone' | 'email';
}

export interface VerifyOtpPayload {
  registration_id: string; // user_id from initiate step
  otp: string;
}

export interface CheckUsernamePayload {
  username: string;
}

export interface CompleteRegistrationPayload {
  registration_id: string;
  username: string;
  login_passcode: string;
  device_id: string;
  fcm_token: string;
}

export interface LoginPayload {
  contact: string; // phone OR email
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

// JWT payload — decoded from access token
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

export interface AuthTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

export interface UserProfileResult {
  id: string;
  phone: string | null;
  email: string | null;
  username: string;
  universal_id: string;
  kyc_tier: number;
  account_status: string;
  has_transaction_pin: boolean;
  has_upp: boolean; // has Universal Payment PIN set
  created_at: Date;
}

export interface InitiateResult {
  registration_id: string;
  contact_type: 'phone' | 'email';
  otp_expires_at: Date;
}

export interface CompleteRegistrationResult {
  tokens: AuthTokens;
  user: UserProfileResult;
}

export type OtpType = 'phone' | 'email';
