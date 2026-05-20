export function serializeProviderResponse(payload: unknown): string {
  try {
    return JSON.stringify(payload).slice(0, 10_000);
  } catch {
    return 'UNSERIALIZABLE_PROVIDER_RESPONSE';
  }
}

export function isMalformedProviderResponse(r: unknown): boolean {
  return typeof r !== 'object' || r === null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function vtpassIsDelivered(r: any): boolean {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  const code = String(r?.code ?? '');
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  const status = String(r?.content?.transactions?.status ?? '');
  return code === '000' && ['delivered', 'successful', ''].includes(status);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function vtpassIsPending(r: any): boolean {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  const code = String(r?.code ?? '');
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  const status = String(r?.content?.transactions?.status ?? '');
  return code === '099' || status === 'pending';
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function vtpassOrderId(r: any): string | null {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  return (r?.content?.transactions?.transactionId as string | undefined) ?? null;
}
