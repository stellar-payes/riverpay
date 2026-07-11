'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createStream, type CancelPolicy } from '@/lib/streams';
import { useWallet } from '@/components/WalletProvider';

const USDC = process.env.NEXT_PUBLIC_USDC_CONTRACT_ID ?? '';
const UNIT = 10_000_000n;
const MONTH_SECS = 30n * 86_400n;

export default function NewStreamPage() {
  const { address } = useWallet();
  const router = useRouter();
  const [to, setTo] = useState('');
  const [perMonth, setPerMonth] = useState('3000');
  const [months, setMonths] = useState('6');
  const [cancel, setCancel] = useState<CancelPolicy>('Both');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    if (!address) return;
    setBusy(true);
    setError(null);
    try {
      const monthly = BigInt(Math.round(Number(perMonth))) * UNIT;
      await createStream(address, {
        to,
        token: USDC,
        deposit: monthly * BigInt(months),
        ratePerSec: monthly / MONTH_SECS,
        cancel,
      });
      router.push('/');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md space-y-6">
      <h1 className="text-2xl font-bold">New stream</h1>

      <label className="block space-y-1">
        <span className="text-sm font-medium">Recipient address</span>
        <input
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder="G..."
          className="w-full rounded-lg border border-neutral-300 p-3 font-mono text-sm"
        />
      </label>

      <label className="block space-y-1">
        <span className="text-sm font-medium">Amount per month (USDC)</span>
        <input
          type="number"
          value={perMonth}
          onChange={(e) => setPerMonth(e.target.value)}
          className="w-full rounded-lg border border-neutral-300 p-3"
        />
      </label>

      <label className="block space-y-1">
        <span className="text-sm font-medium">Months to fund upfront</span>
        <input
          type="number"
          value={months}
          onChange={(e) => setMonths(e.target.value)}
          className="w-full rounded-lg border border-neutral-300 p-3"
        />
      </label>

      <label className="block space-y-1">
        <span className="text-sm font-medium">Who can cancel</span>
        <select
          value={cancel}
          onChange={(e) => setCancel(e.target.value as CancelPolicy)}
          className="w-full rounded-lg border border-neutral-300 p-3"
        >
          <option value="Both">Either of us</option>
          <option value="Sender">Only me</option>
          <option value="Recipient">Only recipient</option>
          <option value="Neither">Nobody (locked)</option>
        </select>
      </label>

      {error && <p className="rounded bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <button
        onClick={handleCreate}
        disabled={!address || !to || busy}
        className="w-full rounded-full bg-brand-600 py-3 font-medium text-white hover:bg-brand-700 disabled:opacity-50"
      >
        {busy ? 'Creating…' : address ? 'Start streaming' : 'Connect wallet first'}
      </button>
    </div>
  );
}
