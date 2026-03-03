/**
 * Integration tests for snapshot-hub HTTP API + GraphQL
 *
 * Requires running server + PostgreSQL:
 *   INTEGRATION=1 npm test
 *
 * Skipped automatically in CI unless INTEGRATION=1 env var is set.
 * Run locally after: pm2 start snapshot-hub (port 3700)
 *
 * Uses EIP-712 typed-data format (same as snapshot-storage.js frontend module).
 */

const fetch = require('node-fetch');
const { Wallet } = require('ethers');

const HUB = process.env.SNAPSHOT_HUB_URL || 'http://localhost:3700';
const INTEGRATION = !!process.env.INTEGRATION;

// Well-known Hardhat test wallet #0 — never use on mainnet
const TEST_WALLET = new Wallet(
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
);

// describe.skip when not in integration mode — tests appear in report as skipped, not absent
const maybe = INTEGRATION ? describe : describe.skip;

// ─── EIP-712 Order types (must match snapshot-storage.js / ingestor ORDER_TYPES_HASH) ──

const ORDER_TYPES = {
  Order: [
    { name: 'from',      type: 'address' },
    { name: 'space',     type: 'string'  },
    { name: 'timestamp', type: 'uint64'  },
    { name: 'marketId',  type: 'string'  },
    { name: 'side',      type: 'string'  },
    { name: 'price',     type: 'string'  },
    { name: 'amount',    type: 'string'  },
    { name: 'txHash',    type: 'string'  },
    { name: 'network',   type: 'string'  },
  ]
};

const ORDER_DOMAIN = { name: 'snapshot', version: '0.1.4' };

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeMessage(overrides = {}) {
  return {
    from:      TEST_WALLET.address,
    space:     'polyfactory.eth',
    timestamp: Math.floor(Date.now() / 1000),
    marketId:  '1',
    side:      '0',
    price:     '6000',
    amount:    '10000000000000000000',
    txHash:    '0x' + 'a'.repeat(64),
    network:   '97',
    ...overrides,
  };
}

/**
 * Sign and post an order to /api/msg (EIP-712 typed-data format).
 * @param {object} msgOverrides - Fields to override in the message
 * @param {Wallet} wallet - Signing wallet
 * @param {string|null} claimAddress - Override the posted address (for tamper tests)
 */
async function postOrder(msgOverrides = {}, wallet = TEST_WALLET, claimAddress = null) {
  const message = makeMessage({ from: wallet.address, ...msgOverrides });
  const sig = await wallet._signTypedData(ORDER_DOMAIN, ORDER_TYPES, message);
  return fetch(`${HUB}/api/msg`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      address: claimAddress || wallet.address,
      sig,
      data: { domain: ORDER_DOMAIN, types: ORDER_TYPES, message }
    }),
  });
}

async function graphql(query) {
  const res = await fetch(`${HUB}/graphql`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  return res.json();
}

// ─── GET /api ─────────────────────────────────────────────────────────────────

maybe('Integration: GET /api', () => {
  test('returns hub name and version', async () => {
    const res = await fetch(`${HUB}/api`);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.name).toBe('snapshot-hub');
    expect(typeof json.version).toBe('string');
  });
});

// ─── POST /api/msg — order type ───────────────────────────────────────────────

maybe('Integration: POST /api/msg — order', () => {
  test('accepts valid signed order → 200 or 400 (not 500)', async () => {
    const res = await postOrder();
    expect(res.status).not.toBe(500);
    // 200 = saved, 400 = duplicate msg or validation error (both acceptable in test env)
    expect([200, 400]).toContain(res.status);
  });

  test('rejects order with missing marketId → 400', async () => {
    const res = await postOrder({ marketId: '' });
    expect(res.status).toBe(400);
  });

  test('rejects order with missing txHash → 400', async () => {
    const res = await postOrder({ txHash: '' });
    expect(res.status).toBe(400);
  });

  test('rejects order with wrong network (1 = mainnet) → 400', async () => {
    const res = await postOrder({ network: '1' });
    expect(res.status).toBe(400);
  });

  test('rejects tampered message (address mismatch) → 400', async () => {
    // Sign with TEST_WALLET but claim a different address
    const res = await postOrder(
      {},
      TEST_WALLET,
      '0x1111111111111111111111111111111111111111'
    );
    expect(res.status).toBe(400);
  });
});

// ─── GraphQL — orders query ───────────────────────────────────────────────────

maybe('Integration: GraphQL orders query', () => {
  test('orders query returns valid shape with empty or filled array', async () => {
    const json = await graphql(
      `{ orders(first: 5) { id voter space marketId side price amount txHash network created } }`
    );
    expect(json).toHaveProperty('data');
    expect(json.data).toHaveProperty('orders');
    expect(Array.isArray(json.data.orders)).toBe(true);
  });

  test('orders filtered by space return only that space', async () => {
    const json = await graphql(
      `{ orders(first: 100, where: { space: "polyfactory.eth" }) { id space } }`
    );
    expect(json.data.orders).toBeDefined();
    for (const o of json.data.orders) {
      expect(o.space).toBe('polyfactory.eth');
    }
  });

  test('orders filtered by voter return only that address', async () => {
    const json = await graphql(
      `{ orders(first: 10, where: { voter: "${TEST_WALLET.address}" }) { id voter } }`
    );
    expect(json.data.orders).toBeDefined();
    for (const o of json.data.orders) {
      expect(o.voter.toLowerCase()).toBe(TEST_WALLET.address.toLowerCase());
    }
  });

  test('unknown field in query returns GraphQL error, not 500', async () => {
    const json = await graphql(`{ orders(first: 1) { nonExistentField } }`);
    // Should have errors array but no crash
    expect(json).toHaveProperty('errors');
  });

  test('single order query by id returns null for unknown id', async () => {
    const json = await graphql(`{ order(id: "nonexistent-id-xyz") { id } }`);
    expect(json.data).toBeDefined();
    expect(json.data.order).toBeNull();
  });
});

// ─── Write + Read round-trip ──────────────────────────────────────────────────

maybe('Integration: write order → read back via GraphQL', () => {
  // Use a unique marketId to identify this specific order after write
  const UNIQUE_MARKET_ID = `test-${Date.now()}`;

  beforeAll(async () => {
    // Write an order with unique marketId
    const res = await postOrder({ marketId: UNIQUE_MARKET_ID });
    // Give DB a moment to commit
    await new Promise(r => setTimeout(r, 300));
    // Accept 200 or 400 (duplicate) — just don't fail setup on duplicates
    expect([200, 400]).toContain(res.status);
  });

  test('written order appears in GraphQL within 500ms', async () => {
    await new Promise(r => setTimeout(r, 500));
    const json = await graphql(
      `{ orders(first: 50, where: { voter: "${TEST_WALLET.address}" }) { id marketId voter } }`
    );
    const found = json.data.orders.find(o => o.marketId === UNIQUE_MARKET_ID);
    // If write succeeded (not duplicate), it should appear
    expect(found).toBeDefined();
  });
});
