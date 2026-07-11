'use client';

import { useState } from 'react';
import { createMany } from '@/lib/streams';
import { useWallet } from '@/components/WalletProvider';

const USDC = process.env.NEXT_PUBLIC_USDC_CONTRACT_ID ?? '';
const UNIT = 10_000_000n;
const MONTH_SECS = 30n * 86_400n;

interface Row {
  to: string;
  monthly: number;
}

/** CSV format: address,monthly_amount — one employee per line. */
function parseCsv(text: string): Row[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const [to, monthly] = line.split(',').map((s) => s.trim());
      return { to, monthly: Number(monthly) };
    })
    .filter((row) => row.to.startsWith('G') && row.monthly > 0);
}

export default function PayrollPage() {
  const { address } = useWallet();
  const [rows, setRows] = useState<Row[]>([]);
  const [months, setMonths] = useState('1');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function handleFile(file: File) {
    file.text().then((text) => setRows(parseCsv(text)));
  }

  const totalMonthly = rows.reduce((sum, r) => sum + r.monthly, 0);
  const runway = Number(months);

  async function handleRun() {
    if (!address) return;
    setBusy(true);
    setError(null);
    try {
      await createMany(
        address,
        rows.map((row) => {
          const monthly = BigInt(Math.round(row.monthly)) * UNIT;
          return {
            to: row.to,
            token: USDC,
            deposit: monthly * BigInt(runway),
            ratePerSec: monthly / MONTH_SECS,
          };
        })
      );
      setDone(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Payroll</h1>
        <p className="text-sm text-neutral-600">
          Upload a CSV (<code>address,monthly_amount</code>) — every employee starts streaming in
          one transaction.
        </p>
      </div>

      <input
        type="file"
        accept=".csv,text/csv"
        onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
        className="block w-full text-sm"
      />

      {rows.length > 0 && (
        <>
          <div className="rounded-lg border border-neutral-200 bg-white">
            <p className="border-b border-neutral-100 p-3 font-medium">
              {rows.length} employees · {totalMonthly.toLocaleString()} USDC/month
            </p>
            {rows.map((row, i) => (
              <div key={i} className="flex justify-between p-3 text-sm">
                <span className="font-mono">{row.to.slice(0, 8)}…</span>
                <span>{row.monthly.toLocaleString()} /mo</span>
              </div>
            ))}
          </div>

          <label className="block space-y-1">
            <span className="text-sm font-medium">Months of runway to deposit</span>
            <input
              type="number"
              value={months}
              onChange={(e) => setMonths(e.target.value)}
              className="w-full rounded-lg border border-neutral-300 p-3"
            />
            <span className="text-xs text-neutral-500">
              Locks {(totalMonthly * runway).toLocaleString()} USDC total
            </span>
          </label>

          {error && <p className="rounded bg-red-50 p-3 text-sm text-red-700">{error}</p>}
          {done && (
            <p className="rounded bg-brand-50 p-3 text-sm text-brand-700">
              Payroll streams created 🎉
            </p>
          )}

          <button
            onClick={handleRun}
            disabled={!address || busy}
            className="w-full rounded-full bg-brand-600 py-3 font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {busy ? 'Submitting…' : `Stream to ${rows.length} employees (one tx)`}
          </button>
        </>
      )}
    </div>
  );
}
