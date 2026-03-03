# Snapshot Hub (PolyFactory fork)

A hub for Snapshot-like off-chain signed message storage. This fork adds:
- **PostgreSQL** support (replaces MySQL)
- **`order` type** — EIP-712 signed CLOB orders for [PolyFactory](https://polyfactory.wpmix.net)
- **GraphQL** `order`/`orders` queries

## Setup

### Requirements

- Node.js 18+
- PostgreSQL 14+

### Environment variables

Copy `.env.example` to `.env`:

```env
DATABASE_URL=postgresql://snaphub:<password>@localhost:5432/snapshotdb
RELAYER_PK=<relayer-private-key>
PORT=3700
```

- `DATABASE_URL` — PostgreSQL connection string
- `RELAYER_PK` — Hub private key to counter-sign messages
- `PORT` — HTTP port (default: 3000, production: 3700)

### Database setup

```sh
# Create user and database
psql postgres -c "CREATE USER snaphub WITH PASSWORD 'snaphub_pass_2026';"
psql postgres -c "CREATE DATABASE snapshotdb OWNER snaphub;"

# Apply schema
psql postgresql://snaphub:snaphub_pass_2026@localhost:5432/snapshotdb \
  -f src/helpers/database/schema_pg.sql
```

### Install and run

```sh
npm install
pm2 start "npm start" --name snapshot-hub
```

Verify: `curl http://localhost:3700/api`

```json
{
  "name": "snapshot-hub",
  "network": "testnet",
  "version": "0.1.4",
  "tag": "alpha",
  "relayer": "0x..."
}
```

## Tests

```sh
# Unit tests (no server needed)
npm run test:unit

# Integration tests (requires running server + PostgreSQL)
INTEGRATION=1 npm run test:integration

# All tests
npm test
```

## Connecting a product to snapshot-hub

See **[INTEGRATION.md](./INTEGRATION.md)** for a full guide:
- EIP-712 `order` message format
- `snapshotSignAndSubmit` / `snapshotLoadOrders` frontend API
- `window.MyApp_` config override pattern
- GraphQL examples

### Quick GraphQL example

```graphql
{
  orders(
    first: 20
    where: { voter: "0x...", space: "polyfactory.eth" }
  ) {
    id voter marketId side price amount txHash network created
  }
}
```

## Production deploy (VM104)

```sh
pm2 restart snapshot-hub
# Server runs on port 3700
# Proxied at: https://snapshot.polyfactory.wpmix.net (optional)
```

## Backup and restore PostgreSQL

```sh
# Backup
pg_dump postgresql://snaphub:snaphub_pass_2026@localhost:5432/snapshotdb \
  > snapshotdb-$(date +%F).sql

# Restore on new server
psql postgresql://snaphub:snaphub_pass_2026@localhost:5432/snapshotdb \
  < snapshotdb-<date>.sql
```

## Upstream

Forked from [snapshot-labs/snapshot-hub](https://github.com/snapshot-labs/snapshot-hub).
MySQL→PostgreSQL migration + `order` type added locally (upstream doesn't accept BSC-specific PRs).
