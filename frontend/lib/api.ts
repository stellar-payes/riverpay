const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export interface StreamRow {
  id: number;
  from: string;
  to: string;
  token: string;
  ratePerSec: string;
  start: number;
  end: number;
  deposited: string;
  withdrawn: string;
  canceled: boolean;
}

async function api<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request to ${path} failed (${res.status})`);
  }
  return res.json();
}

export function getAddressStreams(addr: string): Promise<{ incoming: StreamRow[]; outgoing: StreamRow[] }> {
  return api(`/address/${addr}/streams`);
}

export function getStream(id: number | string): Promise<StreamRow & { withdrawals: unknown[] }> {
  return api(`/streams/${id}`);
}
