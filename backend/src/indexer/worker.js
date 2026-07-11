// Mirrors stream-core events into Postgres and refreshes the
// active_streams_by_address materialized view.
import { rpc, scValToNative } from '@stellar/stellar-sdk';
import { config } from './../config.js';
import { query } from '../db/index.js';

const POLL_INTERVAL_MS = 5_000;
const server = new rpc.Server(config.sorobanRpcUrl);

async function upsertStreamFromChain(streamId) {
  // Full-state read keeps the indexer simple and self-healing: any event on
  // a stream triggers one authoritative re-read instead of incremental math.
  const { Contract, TransactionBuilder, BASE_FEE, Account, nativeToScVal } = await import(
    '@stellar/stellar-sdk'
  );
  const contract = new Contract(config.streamContractId);
  const dummy = new Account('GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7', '0');
  const tx = new TransactionBuilder(dummy, {
    fee: BASE_FEE,
    networkPassphrase: config.networkPassphrase,
  })
    .addOperation(contract.call('get_stream', nativeToScVal(BigInt(streamId), { type: 'u64' })))
    .setTimeout(30)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) return;
  const s = scValToNative(sim.result.retval);

  await query(
    `INSERT INTO streams (id, from_address, to_address, token, rate_per_sec, start_ts, end_ts, deposited, withdrawn, canceled)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (id) DO UPDATE SET
       to_address = EXCLUDED.to_address,
       end_ts = EXCLUDED.end_ts,
       deposited = EXCLUDED.deposited,
       withdrawn = EXCLUDED.withdrawn,
       canceled = EXCLUDED.canceled`,
    [
      streamId,
      s.from,
      s.to,
      s.token,
      String(s.rate_per_sec),
      Number(s.start),
      Number(s.end),
      String(s.deposited),
      String(s.withdrawn),
      s.canceled,
    ]
  );
}

async function tick() {
  if (!config.streamContractId) {
    console.log('STREAM_CONTRACT_ID not set; indexer idle.');
    return;
  }

  const { rows } = await query('SELECT last_ledger FROM indexer_state WHERE id = 1');
  const cursor = Number(rows[0].last_ledger);
  const latest = await server.getLatestLedger();
  const startLedger = cursor > 0 ? cursor + 1 : Math.max(latest.sequence - 10_000, 1);

  const page = await server.getEvents({
    startLedger,
    filters: [{ type: 'contract', contractIds: [config.streamContractId] }],
  });

  const touched = new Set();
  for (const event of page.events ?? []) {
    const topics = event.topic.map((t) => scValToNative(t));
    const [name, streamId] = topics;
    if (streamId !== undefined) touched.add(Number(streamId));
    if (name === 'withdrawn') {
      const [, amount] = scValToNative(event.value);
      await query(
        'INSERT INTO withdrawals (stream_id, amount, tx_hash) VALUES ($1, $2, $3)',
        [Number(streamId), String(amount), event.txHash]
      );
    }
  }
  for (const id of touched) {
    await upsertStreamFromChain(id);
  }
  if (touched.size > 0) {
    await query('REFRESH MATERIALIZED VIEW active_streams_by_address');
  }
  await query('UPDATE indexer_state SET last_ledger = $1 WHERE id = 1', [latest.sequence]);
}

console.log('RiverPay indexer started.');
for (;;) {
  try {
    await tick();
  } catch (err) {
    console.error('Indexer tick failed:', err.message);
  }
  await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
}
