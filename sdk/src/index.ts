import {
  Account,
  Address,
  Contract,
  Keypair,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
  xdr,
} from '@stellar/stellar-sdk';
import {
  accruedAt,
  monthlyToRatePerSec,
  recipientBalanceAt,
  senderBalanceAt,
  type StreamState,
} from './math.js';

export * from './math.js';

export type CancelPolicy = 'Sender' | 'Recipient' | 'Both' | 'Neither';

export interface RiverPayOptions {
  rpcUrl: string;
  networkPassphrase: string;
  contractId: string;
  /** Signs a transaction XDR and returns the signed XDR. */
  sign?: (xdr: string, address: string) => Promise<string>;
}

export interface CreateStreamOptions {
  from: string;
  to: string;
  token: string;
  /** Whole-token amount per 30-day month, e.g. "3000". */
  amountPerMonth: string;
  months: number;
  cancelPolicy?: CancelPolicy;
  decimals?: number;
}

const DEFAULT_DECIMALS = 7;

export class RiverPay {
  readonly server: rpc.Server;
  private readonly contract: Contract;
  private readonly opts: RiverPayOptions;

  constructor(opts: RiverPayOptions) {
    this.opts = opts;
    this.server = new rpc.Server(opts.rpcUrl);
    this.contract = new Contract(opts.contractId);
  }

  get streams() {
    return {
      create: (o: CreateStreamOptions) => this.createStream(o),
      get: (id: bigint) => this.getStream(id),
      watchBalance: (stream: StreamState, cb: (balance: bigint) => void, intervalMs = 1000) =>
        watchBalance(stream, cb, intervalMs),
    };
  }

  /** Builds, signs (via opts.sign), submits, and confirms a create_stream tx. */
  async createStream(o: CreateStreamOptions): Promise<string> {
    const decimals = o.decimals ?? DEFAULT_DECIMALS;
    const unit = 10n ** BigInt(decimals);
    const perMonth = BigInt(o.amountPerMonth) * unit;
    const ratePerSec = monthlyToRatePerSec(perMonth);
    const deposit = perMonth * BigInt(o.months);

    const op = this.contract.call(
      'create_stream',
      new Address(o.from).toScVal(),
      new Address(o.to).toScVal(),
      new Address(o.token).toScVal(),
      nativeToScVal(deposit, { type: 'i128' }),
      nativeToScVal(ratePerSec, { type: 'i128' }),
      xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(o.cancelPolicy ?? 'Both')])
    );

    if (!this.opts.sign) {
      throw new Error('RiverPay: a sign() callback is required to submit transactions');
    }

    const account = await this.server.getAccount(o.from);
    const tx = new TransactionBuilder(account, {
      fee: '1000000',
      networkPassphrase: this.opts.networkPassphrase,
    })
      .addOperation(op)
      .setTimeout(60)
      .build();

    const prepared = await this.server.prepareTransaction(tx);
    const signedXdr = await this.opts.sign(prepared.toXDR(), o.from);
    const signed = TransactionBuilder.fromXDR(signedXdr, this.opts.networkPassphrase);
    const sent = await this.server.sendTransaction(signed);
    if (sent.status === 'ERROR') {
      throw new Error(`create_stream submission failed: ${JSON.stringify(sent.errorResult)}`);
    }
    return sent.hash;
  }

  /** Reads a stream's on-chain state via simulation (free, no signature). */
  async getStream(id: bigint): Promise<StreamState> {
    const source = new Account(Keypair.random().publicKey(), '0');
    const tx = new TransactionBuilder(source, {
      fee: '100',
      networkPassphrase: this.opts.networkPassphrase,
    })
      .addOperation(this.contract.call('get_stream', nativeToScVal(id, { type: 'u64' })))
      .setTimeout(30)
      .build();

    const sim = await this.server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(sim)) {
      throw new Error(`get_stream(${id}) simulation failed: ${sim.error}`);
    }
    const raw = scValToNative(sim.result!.retval) as Record<string, unknown>;
    return {
      ratePerSec: raw.rate_per_sec as bigint,
      start: BigInt(raw.start as bigint),
      end: BigInt(raw.end as bigint),
      deposited: raw.deposited as bigint,
      withdrawn: raw.withdrawn as bigint,
      canceled: raw.canceled as boolean,
    };
  }
}

/**
 * Client-side balance ticker: computes the recipient balance locally from
 * stream params every `intervalMs`, so the UI counts up smoothly with zero
 * RPC polling. Returns a stop function.
 */
export function watchBalance(
  stream: StreamState,
  cb: (balance: bigint) => void,
  intervalMs = 1000
): () => void {
  const tick = () => cb(recipientBalanceAt(stream, BigInt(Math.floor(Date.now() / 1000))));
  tick();
  const timer = setInterval(tick, intervalMs);
  return () => clearInterval(timer);
}

export { accruedAt, recipientBalanceAt, senderBalanceAt, monthlyToRatePerSec };
export type { StreamState };
