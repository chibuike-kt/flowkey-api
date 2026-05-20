import { config } from '../../config';
import { logger } from '../../common/utils/logger';
import { createBreaker, fire } from '../../common/resilience/circuit-breaker';
import type { VtpassResponse, VtpassVerifyResponse, VtpassVariation } from './bills.types';

const LIVE_BASE = 'https://vtpass.com/api';
const SANDBOX_BASE = 'https://sandbox.vtpass.com/api';

/**
 * Whether to call the real VTPass API (live or sandbox).
 * Controlled by VTPASS_LIVE env var:
 *   - Not set or 'false' → use FlowKey stubs (no network call to VTPass)
 *   - 'sandbox'          → call VTPass sandbox (sandbox.vtpass.com) — no real money
 *   - 'true' or 'live'  → call VTPass live (vtpass.com) — real money, production only
 */
function vtpassMode(): 'stub' | 'sandbox' | 'live' {
  const mode = (process.env['VTPASS_LIVE'] ?? '').toLowerCase();
  if (mode === 'live' || mode === 'true') return 'live';
  if (mode === 'sandbox') return 'sandbox';
  return 'stub';
}

function baseUrl(): string {
  return vtpassMode() === 'live' ? LIVE_BASE : SANDBOX_BASE;
}

function useStub(): boolean {
  return vtpassMode() === 'stub';
}

function getHeaders(): Record<string, string> {
  const cfg = config();
  return {
    'api-key': cfg.vtpassApiKey,
    'public-key': cfg.vtpassPublicKey,
  };
}

function postHeaders(): Record<string, string> {
  const cfg = config();
  return {
    'Content-Type': 'application/json',
    'api-key': cfg.vtpassApiKey,
    'secret-key': cfg.vtpassSecretKey,
  };
}

// ---------------------------------------------------------------------------
// Request ID generator
// ---------------------------------------------------------------------------

export function generateVtpassRequestId(suffix?: string): string {
  const now = new Date(Date.now() + 60 * 60 * 1000); // GMT+1 (Lagos)
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  const hour = String(now.getUTCHours()).padStart(2, '0');
  const minute = String(now.getUTCMinutes()).padStart(2, '0');
  const base = `${year}${month}${day}${hour}${minute}`;
  const tail = suffix ?? Math.random().toString(36).slice(2, 10).toUpperCase();
  return `${base}${tail}`;
}

// ---------------------------------------------------------------------------
// Circuit breakers
// ---------------------------------------------------------------------------

const _variationsBreaker = createBreaker(async (serviceId: string) => _fetchVariations(serviceId), {
  name: 'vtpass-variations',
  timeout: 10_000,
  resetTimeout: 30_000,
});

const _verifyBreaker = createBreaker(
  async (payload: Record<string, string>) => _callVerify(payload),
  { name: 'vtpass-verify', timeout: 12_000, resetTimeout: 30_000 },
);

const _payBreaker = createBreaker(async (payload: Record<string, unknown>) => _callPay(payload), {
  name: 'vtpass-pay',
  timeout: 20_000,
  resetTimeout: 60_000,
});

const _requeryBreaker = createBreaker(async (requestId: string) => _callRequery(requestId), {
  name: 'vtpass-requery',
  timeout: 10_000,
  resetTimeout: 30_000,
});

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function getVariations(serviceId: string): Promise<VtpassVariation[]> {
  if (useStub()) return _stubVariations(serviceId);
  return fire(_variationsBreaker, serviceId);
}

export async function verifyCustomer(payload: {
  serviceID: string;
  billersCode: string;
  type?: string;
}): Promise<VtpassVerifyResponse> {
  if (useStub()) return _stubVerify(payload);
  return fire(_verifyBreaker, payload as Record<string, string>);
}

export async function purchaseService(payload: {
  request_id: string;
  serviceID: string;
  amount?: number;
  variation_code?: string;
  phone: string;
  billersCode?: string;
  quantity?: number;
}): Promise<VtpassResponse> {
  if (useStub()) return _stubPurchase(payload);
  return fire(_payBreaker, payload as Record<string, unknown>);
}

export async function requeryTransaction(requestId: string): Promise<VtpassResponse> {
  if (useStub()) return _stubRequery(requestId);
  return fire(_requeryBreaker, requestId);
}

// ---------------------------------------------------------------------------
// Production HTTP calls
// ---------------------------------------------------------------------------

async function _fetchVariations(serviceId: string): Promise<VtpassVariation[]> {
  const res = await fetch(`${baseUrl()}/service-variations?serviceID=${serviceId}`, {
    headers: getHeaders(),
    signal: AbortSignal.timeout(9_000),
  });
  const data = (await res.json()) as { content?: { varations?: VtpassVariation[] } };
  return data.content?.varations ?? [];
}

async function _callVerify(payload: Record<string, string>): Promise<VtpassVerifyResponse> {
  const res = await fetch(`${baseUrl()}/merchant-verify`, {
    method: 'POST',
    headers: postHeaders(),
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(11_000),
  });
  return res.json() as Promise<VtpassVerifyResponse>;
}

async function _callPay(payload: Record<string, unknown>): Promise<VtpassResponse> {
  const res = await fetch(`${baseUrl()}/pay`, {
    method: 'POST',
    headers: postHeaders(),
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(19_000),
  });
  return res.json() as Promise<VtpassResponse>;
}

async function _callRequery(requestId: string): Promise<VtpassResponse> {
  const res = await fetch(`${baseUrl()}/requery`, {
    method: 'POST',
    headers: postHeaders(),
    body: JSON.stringify({ request_id: requestId }),
    signal: AbortSignal.timeout(9_000),
  });
  return res.json() as Promise<VtpassResponse>;
}

// ---------------------------------------------------------------------------
// Sandbox stubs — deterministic, no network calls
// ---------------------------------------------------------------------------

function _stubVariations(serviceId: string): VtpassVariation[] {
  const stubs: Record<string, VtpassVariation[]> = {
    'mtn-data': [
      {
        variation_code: 'mtn-10mb-100',
        name: 'MTN 10MB Daily',
        variation_amount: '100',
        fixedPrice: 'Yes',
      },
      {
        variation_code: 'mtn-1gb',
        name: 'MTN 1GB - 30 Days',
        variation_amount: '1000',
        fixedPrice: 'Yes',
      },
      {
        variation_code: 'mtn-2gb',
        name: 'MTN 2GB - 30 Days',
        variation_amount: '2000',
        fixedPrice: 'Yes',
      },
      {
        variation_code: 'mtn-5gb',
        name: 'MTN 5GB - 30 Days',
        variation_amount: '3500',
        fixedPrice: 'Yes',
      },
      {
        variation_code: 'mtn-10gb',
        name: 'MTN 10GB - 30 Days',
        variation_amount: '6000',
        fixedPrice: 'Yes',
      },
    ],
    'airtel-data': [
      {
        variation_code: 'airtel-1gb',
        name: 'Airtel 1GB - 30 Days',
        variation_amount: '1000',
        fixedPrice: 'Yes',
      },
      {
        variation_code: 'airtel-2gb',
        name: 'Airtel 2GB - 30 Days',
        variation_amount: '2000',
        fixedPrice: 'Yes',
      },
      {
        variation_code: 'airtel-5gb',
        name: 'Airtel 5GB - 30 Days',
        variation_amount: '3500',
        fixedPrice: 'Yes',
      },
    ],
    'glo-data': [
      {
        variation_code: 'glo-1gb',
        name: 'Glo 1GB - 30 Days',
        variation_amount: '1000',
        fixedPrice: 'Yes',
      },
      {
        variation_code: 'glo-2gb',
        name: 'Glo 2GB - 30 Days',
        variation_amount: '2000',
        fixedPrice: 'Yes',
      },
      {
        variation_code: 'glo-5gb',
        name: 'Glo 5GB - 30 Days',
        variation_amount: '3500',
        fixedPrice: 'Yes',
      },
    ],
    '9mobile-data': [
      {
        variation_code: '9mobile-1gb',
        name: '9mobile 1GB - 30 Days',
        variation_amount: '1000',
        fixedPrice: 'Yes',
      },
      {
        variation_code: '9mobile-2gb',
        name: '9mobile 2GB - 30 Days',
        variation_amount: '2000',
        fixedPrice: 'Yes',
      },
    ],
    dstv: [
      {
        variation_code: 'dstv-padi',
        name: 'DStv Padi',
        variation_amount: '2950',
        fixedPrice: 'Yes',
      },
      {
        variation_code: 'dstv-yanga',
        name: 'DStv Yanga',
        variation_amount: '4150',
        fixedPrice: 'Yes',
      },
      {
        variation_code: 'dstv-confam',
        name: 'DStv Confam',
        variation_amount: '6200',
        fixedPrice: 'Yes',
      },
      {
        variation_code: 'dstv-compact',
        name: 'DStv Compact',
        variation_amount: '15700',
        fixedPrice: 'Yes',
      },
      {
        variation_code: 'dstv-compact-plus',
        name: 'DStv Compact Plus',
        variation_amount: '25700',
        fixedPrice: 'Yes',
      },
      {
        variation_code: 'dstv-premium',
        name: 'DStv Premium',
        variation_amount: '37000',
        fixedPrice: 'Yes',
      },
    ],
    gotv: [
      {
        variation_code: 'gotv-smallie',
        name: 'GOtv Smallie',
        variation_amount: '900',
        fixedPrice: 'Yes',
      },
      {
        variation_code: 'gotv-jinja',
        name: 'GOtv Jinja',
        variation_amount: '1900',
        fixedPrice: 'Yes',
      },
      {
        variation_code: 'gotv-jolli',
        name: 'GOtv Jolli',
        variation_amount: '3300',
        fixedPrice: 'Yes',
      },
      { variation_code: 'gotv-max', name: 'GOtv Max', variation_amount: '4850', fixedPrice: 'Yes' },
      {
        variation_code: 'gotv-supa',
        name: 'GOtv Supa',
        variation_amount: '6400',
        fixedPrice: 'Yes',
      },
    ],
    startimes: [
      {
        variation_code: 'nova',
        name: 'Startimes Nova',
        variation_amount: '900',
        fixedPrice: 'Yes',
      },
      {
        variation_code: 'basic',
        name: 'Startimes Basic',
        variation_amount: '2200',
        fixedPrice: 'Yes',
      },
      {
        variation_code: 'smart',
        name: 'Startimes Smart',
        variation_amount: '2800',
        fixedPrice: 'Yes',
      },
      {
        variation_code: 'classic',
        name: 'Startimes Classic',
        variation_amount: '3100',
        fixedPrice: 'Yes',
      },
      {
        variation_code: 'super',
        name: 'Startimes Super',
        variation_amount: '5300',
        fixedPrice: 'Yes',
      },
    ],
    jamb: [
      { variation_code: 'utme', name: 'JAMB UTME', variation_amount: '4700', fixedPrice: 'Yes' },
      {
        variation_code: 'de',
        name: 'JAMB Direct Entry',
        variation_amount: '4700',
        fixedPrice: 'Yes',
      },
    ],
    'waec-registration': [
      {
        variation_code: 'waec-registration',
        name: 'WAEC Registration',
        variation_amount: '16900',
        fixedPrice: 'Yes',
      },
    ],
    waec: [
      {
        variation_code: 'waec',
        name: 'WAEC Result Checker',
        variation_amount: '3500',
        fixedPrice: 'Yes',
      },
    ],
  };
  return stubs[serviceId] ?? [];
}

function _stubVerify(payload: { serviceID: string; billersCode: string }): VtpassVerifyResponse {
  logger.info('[VTPASS STUB] Customer verification', {
    serviceID: payload.serviceID,
    billersCode: `****${payload.billersCode.slice(-4)}`,
  });

  // Electricity
  if (payload.serviceID.includes('electric') || payload.serviceID === 'phed') {
    return {
      code: '000',
      content: {
        Customer_Name: 'Kingsley Chibuike',
        Meter_Number: payload.billersCode,
        Customer_District: 'Lekki',
        Customer_Type: 'prepaid',
      },
      response_description: 'Successful',
    };
  }
  // TV
  return {
    code: '000',
    content: {
      customerName: 'Kingsley Chibuike',
      Customer_Type: 'postpaid',
      Amount: '15700',
      Current_Bouquet: 'DStv Compact',
      Due_Date: '2026-06-17',
    },
    response_description: 'Successful',
  };
}

function _stubPurchase(payload: {
  request_id: string;
  serviceID: string;
  amount?: number;
  phone: string;
}): VtpassResponse {
  logger.info('[VTPASS STUB] Purchase', {
    serviceID: payload.serviceID,
    amount: payload.amount,
    phone: payload.phone.slice(-4),
  });

  return {
    code: '000',
    content: {
      transactions: {
        status: 'delivered',
        product_name: `${payload.serviceID} service`,
        unique_element: payload.phone,
        unit_price: String(payload.amount ?? 0),
        type: payload.serviceID,
        transactionId: `VT${Date.now()}`,
      },
    },
    response_description: 'TRANSACTION SUCCESSFUL',
    requestId: payload.request_id,
    amount: payload.amount ?? 0,
    transaction_date: new Date().toISOString(),
    purchased_code: payload.serviceID.includes('electric')
      ? `TOKEN-${Math.random().toString(36).slice(2, 12).toUpperCase()}`
      : undefined,
    token: payload.serviceID.includes('electric') ? `1234-5678-9012-3456` : null,
    units: payload.serviceID.includes('electric') ? '109.9 kWh' : undefined,
  };
}

function _stubRequery(requestId: string): VtpassResponse {
  logger.info('[VTPASS STUB] Requery', { requestId });
  return {
    code: '000',
    content: {
      transactions: {
        status: 'delivered',
        product_name: 'Requeried service',
        unique_element: '',
        unit_price: '0',
        type: 'requery',
        transactionId: `VT${Date.now()}`,
      },
    },
    response_description: 'TRANSACTION SUCCESSFUL',
    requestId,
    amount: 0,
    transaction_date: new Date().toISOString(),
  };
}
