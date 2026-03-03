CREATE TABLE hubs (
  host VARCHAR(64) NOT NULL,
  address VARCHAR(64),
  is_self INT DEFAULT 0,
  is_active INT DEFAULT 1,
  scope TEXT NOT NULL,
  PRIMARY KEY (host)
);
CREATE INDEX idx_hubs_address ON hubs(address);
CREATE INDEX idx_hubs_is_self ON hubs(is_self);
CREATE INDEX idx_hubs_is_active ON hubs(is_active);

CREATE TABLE messages (
  id VARCHAR(66) NOT NULL,
  ipfs VARCHAR(64) NOT NULL,
  address VARCHAR(64) NOT NULL,
  version VARCHAR(6) NOT NULL,
  "timestamp" BIGINT NOT NULL,
  space VARCHAR(64),
  type VARCHAR(24) NOT NULL,
  sig VARCHAR(256) NOT NULL,
  receipt VARCHAR(128) NOT NULL,
  PRIMARY KEY (id)
);
CREATE INDEX idx_messages_ipfs ON messages(ipfs);
CREATE INDEX idx_messages_address ON messages(address);
CREATE INDEX idx_messages_version ON messages(version);
CREATE INDEX idx_messages_timestamp ON messages("timestamp");
CREATE INDEX idx_messages_space ON messages(space);
CREATE INDEX idx_messages_type ON messages(type);
CREATE INDEX idx_messages_receipt ON messages(receipt);

CREATE TABLE spaces (
  id VARCHAR(64) NOT NULL,
  settings JSONB,
  verified INT NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (id)
);
CREATE INDEX idx_spaces_verified ON spaces(verified);
CREATE INDEX idx_spaces_created_at ON spaces(created_at);
CREATE INDEX idx_spaces_updated_at ON spaces(updated_at);

CREATE TABLE proposals (
  id VARCHAR(66) NOT NULL,
  ipfs VARCHAR(64) NOT NULL,
  author VARCHAR(64) NOT NULL,
  created INT NOT NULL,
  space VARCHAR(64) NOT NULL,
  network VARCHAR(12) NOT NULL,
  type VARCHAR(24) NOT NULL,
  strategies JSONB NOT NULL,
  plugins JSONB NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  choices JSONB NOT NULL,
  "start" INT NOT NULL,
  "end" INT NOT NULL,
  snapshot INT NOT NULL,
  scores JSONB NOT NULL,
  scores_by_strategy JSONB NOT NULL,
  scores_state VARCHAR(24) NOT NULL,
  scores_total NUMERIC(64,30) NOT NULL,
  scores_updated INT NOT NULL,
  votes INT NOT NULL,
  PRIMARY KEY (id)
);
CREATE INDEX idx_proposals_ipfs ON proposals(ipfs);
CREATE INDEX idx_proposals_author ON proposals(author);
CREATE INDEX idx_proposals_created ON proposals(created);
CREATE INDEX idx_proposals_network ON proposals(network);
CREATE INDEX idx_proposals_space ON proposals(space);
CREATE INDEX idx_proposals_start ON proposals("start");
CREATE INDEX idx_proposals_end ON proposals("end");
CREATE INDEX idx_proposals_scores_state ON proposals(scores_state);
CREATE INDEX idx_proposals_scores_updated ON proposals(scores_updated);
CREATE INDEX idx_proposals_votes ON proposals(votes);

CREATE TABLE votes (
  id VARCHAR(66) NOT NULL,
  ipfs VARCHAR(64) NOT NULL,
  voter VARCHAR(64) NOT NULL,
  created INT NOT NULL,
  space VARCHAR(64) NOT NULL,
  proposal VARCHAR(66) NOT NULL,
  choice JSONB NOT NULL,
  metadata JSONB NOT NULL,
  vp NUMERIC(64,30) NOT NULL,
  vp_by_strategy JSONB NOT NULL,
  vp_state VARCHAR(24) NOT NULL,
  cb INT NOT NULL,
  PRIMARY KEY (id)
);
CREATE INDEX idx_votes_ipfs ON votes(ipfs);
CREATE INDEX idx_votes_voter ON votes(voter);
CREATE INDEX idx_votes_created ON votes(created);
CREATE INDEX idx_votes_space ON votes(space);
CREATE INDEX idx_votes_proposal ON votes(proposal);
CREATE INDEX idx_votes_vp ON votes(vp);
CREATE INDEX idx_votes_vp_state ON votes(vp_state);
CREATE INDEX idx_votes_cb ON votes(cb);

CREATE TABLE events (
  id VARCHAR(128) NOT NULL,
  event VARCHAR(64) NOT NULL,
  space VARCHAR(64) NOT NULL,
  expire INT NOT NULL,
  PRIMARY KEY (id, event)
);
CREATE INDEX idx_events_space ON events(space);
CREATE INDEX idx_events_expire ON events(expire);

CREATE TABLE follows (
  id VARCHAR(66) NOT NULL,
  ipfs VARCHAR(64) NOT NULL,
  follower VARCHAR(64) NOT NULL,
  space VARCHAR(64) NOT NULL,
  created INT NOT NULL,
  PRIMARY KEY (follower, space)
);
CREATE INDEX idx_follows_ipfs ON follows(ipfs);
CREATE INDEX idx_follows_created ON follows(created);

CREATE TABLE aliases (
  id VARCHAR(66) NOT NULL,
  ipfs VARCHAR(64) NOT NULL,
  address VARCHAR(64) NOT NULL,
  alias VARCHAR(64) NOT NULL,
  created INT NOT NULL,
  PRIMARY KEY (address, alias)
);
CREATE INDEX idx_aliases_ipfs ON aliases(ipfs);

CREATE TABLE subscriptions (
  id VARCHAR(66) NOT NULL,
  ipfs VARCHAR(64) NOT NULL,
  address VARCHAR(64) NOT NULL,
  space VARCHAR(64) NOT NULL,
  created INT NOT NULL,
  PRIMARY KEY (address, space)
);
CREATE INDEX idx_subscriptions_ipfs ON subscriptions(ipfs);
CREATE INDEX idx_subscriptions_created ON subscriptions(created);

-- PolyFactory order storage (added 2026-03-03)
CREATE TABLE IF NOT EXISTS orders (
  id VARCHAR(66) NOT NULL,
  ipfs VARCHAR(64) NOT NULL DEFAULT '',
  voter VARCHAR(64) NOT NULL,
  created INT NOT NULL,
  space VARCHAR(64) NOT NULL,
  market_id VARCHAR(32) NOT NULL,
  side SMALLINT NOT NULL,
  price VARCHAR(32) NOT NULL,
  amount VARCHAR(78) NOT NULL,
  tx_hash VARCHAR(66) NOT NULL,
  network VARCHAR(12) NOT NULL,
  sig VARCHAR(256) NOT NULL,
  PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS idx_orders_voter ON orders(voter);
CREATE INDEX IF NOT EXISTS idx_orders_space ON orders(space);
CREATE INDEX IF NOT EXISTS idx_orders_market_id ON orders(market_id);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created);
