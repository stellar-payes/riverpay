import { query } from '../db/index.js';

function formatStream(row) {
  return {
    id: Number(row.id),
    from: row.from_address,
    to: row.to_address,
    token: row.token,
    ratePerSec: row.rate_per_sec,
    start: Number(row.start_ts),
    end: Number(row.end_ts),
    deposited: row.deposited,
    withdrawn: row.withdrawn,
    canceled: row.canceled,
  };
}

export default async function streamsRoutes(fastify) {
  // All streams touching an address, incoming and outgoing.
  fastify.get('/address/:addr/streams', async (request) => {
    const { addr } = request.params;
    const { rows } = await query(
      `SELECT * FROM streams
       WHERE from_address = $1 OR to_address = $1
       ORDER BY created_at DESC`,
      [addr]
    );
    return {
      incoming: rows.filter((r) => r.to_address === addr).map(formatStream),
      outgoing: rows.filter((r) => r.from_address === addr).map(formatStream),
    };
  });

  fastify.get('/streams/:id', async (request, reply) => {
    const { rows } = await query('SELECT * FROM streams WHERE id = $1', [request.params.id]);
    if (rows.length === 0) {
      return reply.code(404).send({ error: 'stream not found' });
    }
    const { rows: withdrawals } = await query(
      'SELECT amount, tx_hash, created_at FROM withdrawals WHERE stream_id = $1 ORDER BY created_at',
      [request.params.id]
    );
    return { ...formatStream(rows[0]), withdrawals };
  });

  // Streams running out within `days` (default 3) — feeds "top up" nudges.
  fastify.get('/streams/ending-soon', async (request) => {
    const days = Number(request.query.days ?? 3);
    const cutoff = Math.floor(Date.now() / 1000) + days * 86_400;
    const { rows } = await query(
      `SELECT * FROM streams
       WHERE NOT canceled AND end_ts BETWEEN EXTRACT(EPOCH FROM now()) AND $1
       ORDER BY end_ts`,
      [cutoff]
    );
    return rows.map(formatStream);
  });
}
