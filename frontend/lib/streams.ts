'use client';

import { Contract, nativeToScVal, xdr } from '@stellar/stellar-sdk';
import { buildSignAndSubmit, scAddress, scI128, scU64 } from './soroban';
import { signTransaction } from './walletKit';
import type { StreamRow } from './api';

const CONTRACT_ID = process.env.NEXT_PUBLIC_STREAM_CONTRACT_ID ?? '';

function contract() {
  if (!CONTRACT_ID) throw new Error('NEXT_PUBLIC_STREAM_CONTRACT_ID is not configured');
  return new Contract(CONTRACT_ID);
}

export type CancelPolicy = 'Sender' | 'Recipient' | 'Both' | 'Neither';

function policyScVal(policy: CancelPolicy) {
  return xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(policy)]);
}

export async function createStream(
  publicKey: string,
  params: { to: string; token: string; deposit: bigint; ratePerSec: bigint; cancel: CancelPolicy }
) {
  const op = contract().call(
    'create_stream',
    scAddress(publicKey),
    scAddress(params.to),
    scAddress(params.token),
    scI128(params.deposit),
    scI128(params.ratePerSec),
    policyScVal(params.cancel)
  );
  return buildSignAndSubmit(publicKey, [op], signTransaction);
}

export async function createMany(
  publicKey: string,
  legs: { to: string; token: string; deposit: bigint; ratePerSec: bigint }[]
) {
  const mapEntry = (key: string, val: xdr.ScVal) =>
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(key), val });
  // StreamParams struct — ScMap fields in alphabetical order.
  const params = xdr.ScVal.scvVec(
    legs.map((leg) =>
      xdr.ScVal.scvMap([
        mapEntry('cancel', policyScVal('Sender')),
        mapEntry('deposit', nativeToScVal(leg.deposit, { type: 'i128' })),
        mapEntry('rate_per_sec', nativeToScVal(leg.ratePerSec, { type: 'i128' })),
        mapEntry('to', scAddress(leg.to)),
        mapEntry('token', scAddress(leg.token)),
      ])
    )
  );
  const op = contract().call('create_many', scAddress(publicKey), params);
  return buildSignAndSubmit(publicKey, [op], signTransaction);
}

export async function withdraw(publicKey: string, streamId: number, amount: bigint) {
  const op = contract().call('withdraw', scU64(streamId), scI128(amount));
  return buildSignAndSubmit(publicKey, [op], signTransaction);
}

export async function topUp(publicKey: string, streamId: number, amount: bigint) {
  const op = contract().call('top_up', scU64(streamId), scI128(amount));
  return buildSignAndSubmit(publicKey, [op], signTransaction);
}

export async function cancelStream(publicKey: string, streamId: number) {
  const op = contract().call('cancel', scU64(streamId), scAddress(publicKey));
  return buildSignAndSubmit(publicKey, [op], signTransaction);
}

/** Local balance ticker — mirrors the contract math so the UI counts up
 * smoothly without polling the chain. */
export function recipientBalanceNow(stream: StreamRow): bigint {
  if (stream.canceled) return 0n;
  const now = Math.min(Math.floor(Date.now() / 1000), stream.end);
  const elapsed = Math.max(now - stream.start, 0);
  return BigInt(elapsed) * BigInt(stream.ratePerSec) - BigInt(stream.withdrawn);
}
