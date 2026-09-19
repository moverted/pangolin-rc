-- Idempotency ledger for the offline outbox (pg_offline.js). Every write that originates
-- from the client outbox carries a stable client-generated op id in the `X-PG-Op-Id` header.
-- The Worker claims the id here before running the handler; a replay (same id) is short-
-- circuited instead of creating a duplicate row (a second logged episode, ticket, comment…).
-- Claims for handlers that then fail are released, so a genuine retry still goes through.
CREATE TABLE IF NOT EXISTS processed_ops (
  op_id      TEXT    PRIMARY KEY,
  created_at INTEGER NOT NULL
);
-- Lets a housekeeping sweep prune old ids by age without a full scan.
CREATE INDEX IF NOT EXISTS idx_processed_ops_created ON processed_ops(created_at);
