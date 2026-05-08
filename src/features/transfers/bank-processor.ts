import { logger } from '../../common/utils/logger';
import type { BankProcessorResponse } from './transfers.types';

const IS_PRODUCTION = process.env['NODE_ENV'] === 'production';

// Simulate processing time (ms) — realistic for demo/testing
const STUB_PROCESSING_MS = 2000 + Math.random() * 3000; // 2-5 seconds

// Stub success rate in non-production (for testing failure paths too)
// Set BANK_STUB_FAIL_RATE=0.2 to simulate 20% failure rate in staging
const STUB_FAIL_RATE = parseFloat(process.env['BANK_STUB_FAIL_RATE'] ?? '0');

// ---------------------------------------------------------------------------
// Main processor entry point — called from BullMQ worker
// ---------------------------------------------------------------------------

export async function processBankTransfer(params: {
  transactionId: string;
  reference: string;
  amountKobo: bigint;
  bankCode: string;
  accountNumber: string;
  accountName: string;
  narration: string | null;
}): Promise<BankProcessorResponse> {
  if (IS_PRODUCTION) {
    return processProduction(params);
  }
  return processStub(params);
}

// ---------------------------------------------------------------------------
// Stub processor — for development, staging, and demo
// ---------------------------------------------------------------------------

async function processStub(params: {
  transactionId: string;
  reference: string;
  amountKobo: bigint;
  bankCode: string;
  accountNumber: string;
}): Promise<BankProcessorResponse> {
  logger.info('[BANK STUB] Processing transfer', {
    transaction_id: params.transactionId,
    reference: params.reference,
    amount_kobo: params.amountKobo.toString(),
    bank_code: params.bankCode,
    account_last4: params.accountNumber.slice(-4),
  });

  // Simulate network/processing time
  await delay(STUB_PROCESSING_MS);

  // Simulate configurable failure rate
  if (Math.random() < STUB_FAIL_RATE) {
    logger.warn('[BANK STUB] Simulated transfer failure', {
      transaction_id: params.transactionId,
      fail_rate: STUB_FAIL_RATE,
    });
    return {
      success: false,
      bank_response_code: 'INSUFFICIENT_FUNDS_DESTINATION',
      failure_reason: 'Destination bank rejected transfer (simulated)',
    };
  }

  const processorReference = `PSK-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

  logger.info('[BANK STUB] Transfer completed', {
    transaction_id: params.transactionId,
    processor_reference: processorReference,
  });

  return {
    success: true,
    processor_reference: processorReference,
    bank_response_code: '00', // standard success code
  };
}

// ---------------------------------------------------------------------------
// Production processor — integrate real payment provider here
// ---------------------------------------------------------------------------

async function processProduction(params: {
  transactionId: string;
  reference: string;
  amountKobo: bigint;
  bankCode: string;
  accountNumber: string;
  accountName: string;
  narration: string | null;
}): Promise<BankProcessorResponse> {
  // TODO: Integrate Paystack Transfers API
  // POST https://api.paystack.co/transfer
  // {
  //   source: 'balance',
  //   amount: Number(params.amountKobo),   // Paystack uses kobo
  //   recipient: params.paystackRecipientCode,
  //   reason: params.narration ?? params.reference,
  //   reference: params.reference,
  // }
  //
  // Paystack will POST to our webhook when the transfer settles.
  // We do NOT poll — webhook drives status updates.
  //
  // For now throw so any accidental production call is loud:
  logger.error('[BANK PROCESSOR] Production processor not yet configured', {
    transaction_id: params.transactionId,
  });
  throw new Error(
    `[BankProcessor] Production bank API not configured. ` +
      `Transaction ${params.transactionId} (${params.reference}) cannot be processed.`,
  );
}

// ---------------------------------------------------------------------------
// Account name enquiry — called before transfer to verify account
// ---------------------------------------------------------------------------

export async function resolveAccountName(
  bankCode: string,
  accountNumber: string,
): Promise<{ account_name: string; bank_name: string }> {
  if (IS_PRODUCTION) {
    // TODO: Paystack Resolve Account
    // GET https://api.paystack.co/bank/resolve?account_number=X&bank_code=Y
    throw new Error('[BankProcessor] Production account resolution not configured.');
  }

  // Stub — return a deterministic fake name based on account number
  await delay(500);
  return {
    account_name: `Account ${accountNumber.slice(-4)}`,
    bank_name: bankCodeToName(bankCode),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function bankCodeToName(code: string): string {
  const banks: Record<string, string> = {
    '058': 'Guaranty Trust Bank',
    '011': 'First Bank of Nigeria',
    '044': 'Access Bank',
    '023': 'Citibank Nigeria',
    '057': 'Zenith Bank',
    '033': 'United Bank for Africa',
    '068': 'Standard Chartered Bank',
    '070': 'Fidelity Bank',
    '221': 'Stanbic IBTC Bank',
    '035': 'Wema Bank',
    '032': 'Union Bank',
    '301': 'Jaiz Bank',
    '000013': 'GTBank (NUBAN)',
    '100004': 'Opay',
    '100033': 'PalmPay',
    '999992': 'Paystack (Test)',
  };
  return banks[code] ?? `Bank (${code})`;
}
