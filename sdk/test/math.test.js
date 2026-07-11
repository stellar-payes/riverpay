import test from 'node:test';
import assert from 'node:assert/strict';
import {
  accruedAt,
  recipientBalanceAt,
  senderBalanceAt,
  monthlyToRatePerSec,
  watchBalance,
} from '../dist/index.js';

const stream = {
  ratePerSec: 100n,
  start: 1_700_000_000n,
  end: 1_700_010_000n, // 10_000s * 100 = 1_000_000 deposited
  deposited: 1_000_000n,
  withdrawn: 0n,
  canceled: false,
};

test('accrues linearly between start and end', () => {
  assert.equal(accruedAt(stream, stream.start), 0n);
  assert.equal(accruedAt(stream, stream.start + 500n), 50_000n);
  assert.equal(accruedAt(stream, stream.end), 1_000_000n);
});

test('caps at end and floors at start', () => {
  assert.equal(accruedAt(stream, stream.end + 999_999n), 1_000_000n);
  assert.equal(accruedAt(stream, stream.start - 100n), 0n);
});

test('recipient + sender balances always sum to deposited', () => {
  for (const dt of [0n, 1n, 777n, 9_999n, 10_000n, 50_000n]) {
    const now = stream.start + dt;
    assert.equal(
      recipientBalanceAt(stream, now) + senderBalanceAt(stream, now),
      stream.deposited,
      `conservation violated at dt=${dt}`
    );
  }
});

test('withdrawals reduce recipient balance only', () => {
  const withdrew = { ...stream, withdrawn: 30_000n };
  assert.equal(recipientBalanceAt(withdrew, stream.start + 500n), 20_000n);
  assert.equal(senderBalanceAt(withdrew, stream.start + 500n), 950_000n);
});

test('canceled stream stops accruing', () => {
  const canceled = { ...stream, canceled: true, withdrawn: 40_000n };
  assert.equal(recipientBalanceAt(canceled, stream.end + 100n), 0n);
});

test('monthlyToRatePerSec uses 30-day months', () => {
  const perMonth = 2_592_000n; // exactly 1 stroop/sec
  assert.equal(monthlyToRatePerSec(perMonth), 1n);
});

test('watchBalance ticks locally and stops cleanly', async () => {
  const now = BigInt(Math.floor(Date.now() / 1000));
  const live = { ...stream, start: now - 100n, end: now + 10_000n };
  const seen = [];
  const stop = watchBalance(live, (b) => seen.push(b), 10);
  await new Promise((r) => setTimeout(r, 50));
  stop();
  assert.ok(seen.length >= 1);
  assert.ok(seen[0] >= 100n * 100n - 100n);
});
