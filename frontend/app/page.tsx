'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getAddressStreams, type StreamRow } from '@/lib/api';
import { recipientBalanceNow, withdraw } from '@/lib/streams';
import { useWallet } from '@/components/WalletProvider';

const UNIT = 10_000_000; // 7 decimals

function LiveBalance({ stream }: { stream: StreamRow }) {
  const [balance, setBalance] = useState(0n);
  useEffect(() => {
    const timer = setInterval(() => setBalance(recipientBalanceNow(stream)), 250);
    return () => clearInterval(timer);
  }, [stream]);
  return (
    <span className="font-mono text-brand-700 tabular-nums">
      {(Number(balance) / UNIT).toFixed(7)}
    </span>
  );
}

export default function MyIncomePage() {
  const { address } = useWallet();
  const [incoming, setIncoming] = useState<StreamRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  useEffect(() => {
    if (!address) return;
    getAddressStreams(address)
      .then((res) => setIncoming(res.incoming))
      .catch((err) => setError(err.message));
  }, [address]);

  if (!address) {
    return (
      <div className="space-y-4 text-center">
        <h1 className="text-3xl font-bold">Get paid by the second.</h1>
        <p className="text-neutral-600">
          Connect your wallet to see your incoming streams, or{' '}
          <Link href="/new" className="text-brand-600 underline">
            start streaming money
          </Link>{' '}
          to someone.
        </p>
      </div>
    );
  }

  const active = incoming.filter((s) => !s.canceled);
  const monthlyIncome = active.reduce(
    (sum, s) => sum + (Number(s.ratePerSec) * 30 * 86_400) / UNIT,
    0
  );

  async function handleWithdraw(stream: StreamRow) {
    if (!address) return;
    setBusy(stream.id);
    setError(null);
    try {
      await withdraw(address, stream.id, recipientBalanceNow(stream));
      setIncoming((await getAddressStreams(address)).incoming);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg bg-brand-50 p-6">
        <p className="text-sm text-neutral-600">Projected monthly income</p>
        <p className="text-3xl font-bold text-brand-700">{monthlyIncome.toLocaleString()} </p>
        <p className="text-xs text-neutral-500">{active.length} active incoming streams</p>
      </div>

      {error && <p className="rounded bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <div className="space-y-3">
        {incoming.map((stream) => (
          <div
            key={stream.id}
            className="flex items-center justify-between rounded-lg border border-neutral-200 bg-white p-4"
          >
            <div>
              <Link href={`/stream/${stream.id}`} className="font-semibold text-brand-700">
                Stream #{stream.id}
              </Link>
              <p className="text-sm text-neutral-600">
                accrued: <LiveBalance stream={stream} />
              </p>
            </div>
            <button
              onClick={() => handleWithdraw(stream)}
              disabled={busy === stream.id || stream.canceled}
              className="rounded-full bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {busy === stream.id ? 'Withdrawing…' : 'Withdraw'}
            </button>
          </div>
        ))}
        {incoming.length === 0 && (
          <p className="rounded-lg border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500">
            No incoming streams yet.
          </p>
        )}
      </div>
    </div>
  );
}
