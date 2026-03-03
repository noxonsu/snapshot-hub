-- Seed polyfactory.eth space for PolyFactory CLOB orderbook
-- Run: psql postgresql://snaphub:snaphub_pass_2026@localhost:5432/snapshotdb -f scripts/seed-space.sql
INSERT INTO spaces (id, settings, verified, created_at, updated_at)
VALUES (
  'polyfactory.eth',
  '{"name":"PolyFactory","network":"97","symbol":"USDT","strategies":[{"name":"ticket","params":{"value":1}}],"admins":[],"members":[],"filters":{"minScore":0,"onlyMembers":false},"voting":{"delay":0,"period":3600,"type":"single-choice","quorum":0},"about":"PolyFactory CLOB Prediction Market on BSC Testnet","private":false,"categories":["defi"]}',
  1,
  EXTRACT(EPOCH FROM NOW())::bigint,
  EXTRACT(EPOCH FROM NOW())::bigint
)
ON CONFLICT (id) DO UPDATE SET
  updated_at = EXTRACT(EPOCH FROM NOW())::bigint,
  verified = 1;
