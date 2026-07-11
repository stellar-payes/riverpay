/**
 * Pure stream math, mirrored 1:1 from the stream-core contract so a UI can
 * tick balances locally without touching the chain. All bigint — the
 * contract is i128 and JS numbers lose precision past 2^53.
 */

export interface StreamState {
  ratePerSec: bigint;
  start: bigint; // unix seconds
  end: bigint;
  deposited: bigint;
  withdrawn: bigint;
  canceled: boolean;
}

/** Total streamed to the recipient as of `now` (unix seconds). */
export function accruedAt(stream: StreamState, now: bigint): bigint {
  if (stream.canceled) return stream.withdrawn;
  const effective = now < stream.end ? now : stream.end;
  const elapsed = effective > stream.start ? effective - stream.start : 0n;
  return elapsed * stream.ratePerSec;
}

/** Recipient's withdrawable balance as of `now`. */
export function recipientBalanceAt(stream: StreamState, now: bigint): bigint {
  return accruedAt(stream, now) - stream.withdrawn;
}

/** Sender's refundable remainder as of `now`. */
export function senderBalanceAt(stream: StreamState, now: bigint): bigint {
  return stream.deposited - accruedAt(stream, now);
}

/** Converts a human "per month" amount into the contract's rate-per-second. */
export function monthlyToRatePerSec(amountPerMonth: bigint): bigint {
  const SECONDS_PER_MONTH = 30n * 24n * 60n * 60n;
  return amountPerMonth / SECONDS_PER_MONTH;
}
