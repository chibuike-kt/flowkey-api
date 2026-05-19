export type BillCategory = 'airtime' | 'data' | 'tv' | 'electricity' | 'education';

export type BillStatus =
  | 'pending' // queued, VTPass call not yet made
  | 'processing' // VTPass call in progress
  | 'delivered' // VTPass code 000 — fully successful
  | 'failed' // VTPass rejected — wallet refunded
  | 'refunded'; // failed + refund credited back

// ---------------------------------------------------------------------------
// Network / Provider identifiers
// ---------------------------------------------------------------------------

export type AirtimeNetwork = 'mtn' | 'airtel' | 'glo' | '9mobile';
export type DataNetwork = 'mtn' | 'airtel' | 'glo' | '9mobile';

export type TvProvider = 'dstv' | 'gotv' | 'startimes' | 'showmax';

export type ElectricityDisco =
  | 'ikeja-electric' // IKEDC
  | 'eko-electric' // EKEDC
  | 'kano-electric' // KEDCO
  | 'phed' // Port Harcourt
  | 'jos-electric' // JED
  | 'ibadan-electric' // IBEDC
  | 'kaduna-electric' // KAEDCO
  | 'abuja-electric' // AEDC
  | 'enugu-electric' // EEDC
  | 'benin-electric' // BEDC
  | 'aba-electric' // ABA
  | 'yola-electric'; // YEDC

export type EducationProduct = 'waec-registration' | 'waec' | 'jamb';

export type MeterType = 'prepaid' | 'postpaid';

// ---------------------------------------------------------------------------
// VTPass service ID map
// ---------------------------------------------------------------------------

export const VTPASS_SERVICE_IDS: Record<string, string> = {
  // Airtime
  mtn: 'mtn',
  airtel: 'airtel',
  glo: 'glo',
  '9mobile': 'etisalat',
  // Data
  'mtn-data': 'mtn-data',
  'airtel-data': 'airtel-data',
  'glo-data': 'glo-data',
  '9mobile-data': '9mobile-data',
  // TV
  dstv: 'dstv',
  gotv: 'gotv',
  startimes: 'startimes',
  showmax: 'showmax',
  // Electricity
  'ikeja-electric': 'ikeja-electric',
  'eko-electric': 'eko-electric',
  'kano-electric': 'kano-electric',
  phed: 'phed',
  'jos-electric': 'jos-electric',
  'ibadan-electric': 'ibadan-electric',
  'kaduna-electric': 'kaduna-electric',
  'abuja-electric': 'abuja-electric',
  'enugu-electric': 'enugu-electric',
  'benin-electric': 'benin-electric',
  'aba-electric': 'aba-electric',
  'yola-electric': 'yola-electric',
  // Education
  'waec-registration': 'waec-registration',
  waec: 'waec',
  jamb: 'jamb',
};

// ---------------------------------------------------------------------------
// VTPass API response shapes
// ---------------------------------------------------------------------------

export interface VtpassResponse {
  code: string; // '000' = success, '099' = pending
  content: {
    transactions: {
      status: string; // 'delivered' | 'failed' | 'pending'
      product_name: string;
      unique_element: string; // phone/meter/smartcard
      unit_price: string;
      type: string;
      transactionId: string;
    };
  };
  response_description: string;
  requestId: string;
  amount: number;
  transaction_date: string;
  purchased_code?: string; // electricity token
  token?: string | null;
  units?: string; // electricity units e.g. "109.9 kWh"
  customerName?: string | null;
  customerAddress?: string | null;
}

export interface VtpassVerifyResponse {
  code: string;
  content: {
    Customer_Name?: string;
    customerName?: string;
    Meter_Number?: string;
    Customer_District?: string;
    Customer_Type?: string; // prepaid | postpaid
    Amount?: string; // renewal amount for TV
    Current_Bouquet?: string;
    Due_Date?: string;
  };
  response_description: string;
}

export interface VtpassVariation {
  variation_code: string;
  name: string;
  variation_amount: string;
  fixedPrice: string;
}

// ---------------------------------------------------------------------------
// Bill record (what FlowKey stores)
// ---------------------------------------------------------------------------

export interface BillRecord {
  id: string;
  user_id: string;
  wallet_id: string;
  category: BillCategory;
  service_id: string; // vtpass serviceID
  transaction_number: string;
  reference: string;
  vtpass_request_id: string;
  vtpass_order_id: string | null;
  status: BillStatus;
  amount_kobo: string;
  fee_kobo: string;
  narration: string;
  // Recipient details — varies by category
  recipient: BillRecipient;
  // VTPass result fields
  purchased_code: string | null; // electricity token
  units: string | null; // electricity kWh
  provider_response: string | null;
  // Timestamps
  created_at: Date;
  completed_at: Date | null;
}

export interface BillRecipient {
  // Airtime / Data
  phone?: string;
  network?: string;
  plan_name?: string;
  // TV
  smartcard?: string;
  provider?: string;
  bouquet?: string;
  customer_name?: string;
  // Electricity
  meter_number?: string;
  meter_type?: MeterType;
  disco?: string;
  address?: string;
  // Education
  exam_type?: string;
  quantity?: number;
}

// ---------------------------------------------------------------------------
// Variation / plan types returned to client
// ---------------------------------------------------------------------------

export interface DataPlan {
  code: string;
  name: string;
  amount: number; // naira
}

export interface TvPlan {
  code: string;
  name: string;
  amount: number;
}

export interface DiscoInfo {
  id: ElectricityDisco;
  name: string;
}

export const DISCO_LIST: DiscoInfo[] = [
  { id: 'ikeja-electric', name: 'Ikeja Electric (IKEDC)' },
  { id: 'eko-electric', name: 'Eko Electric (EKEDC)' },
  { id: 'kano-electric', name: 'Kano Electric (KEDCO)' },
  { id: 'phed', name: 'Port Harcourt Electric (PHED)' },
  { id: 'jos-electric', name: 'Jos Electric (JED)' },
  { id: 'ibadan-electric', name: 'Ibadan Electric (IBEDC)' },
  { id: 'kaduna-electric', name: 'Kaduna Electric (KAEDCO)' },
  { id: 'abuja-electric', name: 'Abuja Electric (AEDC)' },
  { id: 'enugu-electric', name: 'Enugu Electric (EEDC)' },
  { id: 'benin-electric', name: 'Benin Electric (BEDC)' },
  { id: 'aba-electric', name: 'Aba Electric (ABEDC)' },
  { id: 'yola-electric', name: 'Yola Electric (YEDC)' },
];
