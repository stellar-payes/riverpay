CREATE TABLE IF NOT EXISTS streams (
  id BIGINT PRIMARY KEY,
  from_address TEXT NOT NULL,
  to_address TEXT NOT NULL,
  token TEXT NOT NULL,
  rate_per_sec NUMERIC(30, 0) NOT NULL,
  start_ts BIGINT NOT NULL,
  end_ts BIGINT NOT NULL,
  deposited NUMERIC(30, 0) NOT NULL,
  withdrawn NUMERIC(30, 0) NOT NULL DEFAULT 0,
  canceled BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS streams_from_idx ON streams(from_address);
CREATE INDEX IF NOT EXISTS streams_to_idx ON streams(to_address);

CREATE TABLE IF NOT EXISTS withdrawals (
  id BIGSERIAL PRIMARY KEY,
  stream_id BIGINT NOT NULL REFERENCES streams(id),
  amount NUMERIC(30, 0) NOT NULL,
  tx_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per address with a live stream in either direction; refreshed by
-- the indexer after each batch of events.
CREATE MATERIALIZED VIEW IF NOT EXISTS active_streams_by_address AS
SELECT addr, COUNT(*) AS active_streams, SUM(rate_per_sec) AS total_rate
FROM (
  SELECT from_address AS addr, rate_per_sec FROM streams WHERE NOT canceled
  UNION ALL
  SELECT to_address AS addr, rate_per_sec FROM streams WHERE NOT canceled
) s
GROUP BY addr;

CREATE TABLE IF NOT EXISTS indexer_state (
  id INT PRIMARY KEY DEFAULT 1,
  last_ledger BIGINT NOT NULL DEFAULT 0
);
INSERT INTO indexer_state (id, last_ledger) VALUES (1, 0) ON CONFLICT DO NOTHING;
