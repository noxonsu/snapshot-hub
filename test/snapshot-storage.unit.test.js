/**
 * Retrospective unit tests for snapshot-storage.js (PolyFactory frontend module)
 *
 * Tests the logic that lives in frontend/snapshot-storage.js:
 * - EIP-712 type structure consistency
 * - Config helper fallback chain
 * - Order field mapping & validation
 * - snapshotLoadOrders query builder
 * - snapshotRenderOrders output shape
 *
 * These run without a browser (JSDOM not needed) — pure logic tests.
 * Run: npm run test:unit
 */

const fs   = require('fs');
const path = require('path');

// ─── Load snapshot-storage.js in a fake browser-like env ─────────────────────
// We eval the file with minimal stubs for window, CONFIG, ethers, document

function loadSnapshotStorage(overrides = {}) {
  const src = fs.readFileSync(
    path.resolve(__dirname, '../../PolyFactory/frontend/snapshot-storage.js'),
    'utf8'
  );

  const ctx = {
    window:   overrides.window   ?? {},
    CONFIG:   overrides.CONFIG   ?? { CHAIN_ID: 97, BLOCK_EXPLORER: 'https://testnet.bscscan.com' },
    ethers:   overrides.ethers   ?? { formatEther: (v) => String(Number(v) / 1e18) },
    document: overrides.document ?? { getElementById: () => null },
    fetch:    overrides.fetch    ?? (() => Promise.resolve({ ok: true, json: () => ({}) })),
  };

  // Execute file in context
  const fn = new Function(
    'window', 'CONFIG', 'ethers', 'document', 'fetch',
    src + '\n return { _hubUrl, _space, _chainId, SNAPSHOT_ORDER_TYPES, SNAPSHOT_ORDER_DOMAIN, snapshotLoadOrders, snapshotRenderOrders, snapshotLoadAndRender };'
  );
  return fn(ctx.window, ctx.CONFIG, ctx.ethers, ctx.document, ctx.fetch);
}

// ─── Config helpers ───────────────────────────────────────────────────────────

describe('snapshot-storage config helpers', () => {
  test('_hubUrl() defaults to localhost:3700', () => {
    const m = loadSnapshotStorage({ CONFIG: {} });
    expect(m._hubUrl()).toBe('http://localhost:3700');
  });

  test('_hubUrl() reads from CONFIG.SNAPSHOT_HUB_URL', () => {
    const m = loadSnapshotStorage({ CONFIG: { SNAPSHOT_HUB_URL: 'http://my-hub:4000' } });
    expect(m._hubUrl()).toBe('http://my-hub:4000');
  });

  test('_hubUrl() strips trailing slash', () => {
    const m = loadSnapshotStorage({ CONFIG: { SNAPSHOT_HUB_URL: 'http://my-hub:4000/' } });
    expect(m._hubUrl()).toBe('http://my-hub:4000');
  });

  test('_hubUrl() window.PolyFactory_ takes priority over CONFIG', () => {
    const m = loadSnapshotStorage({
      window: { PolyFactory_: { SNAPSHOT_HUB_URL: 'http://override:9999' } },
      CONFIG: { SNAPSHOT_HUB_URL: 'http://config:4000' },
    });
    expect(m._hubUrl()).toBe('http://override:9999');
  });

  test('_space() defaults to polyfactory.eth', () => {
    const m = loadSnapshotStorage({ CONFIG: {} });
    expect(m._space()).toBe('polyfactory.eth');
  });

  test('_space() reads from CONFIG.SNAPSHOT_SPACE', () => {
    const m = loadSnapshotStorage({ CONFIG: { SNAPSHOT_SPACE: 'farm.wpmix.net' } });
    expect(m._space()).toBe('farm.wpmix.net');
  });

  test('_space() window.PolyFactory_.SNAPSHOT_SPACE overrides CONFIG', () => {
    const m = loadSnapshotStorage({
      window: { PolyFactory_: { SNAPSHOT_SPACE: 'dao.wpmix.net' } },
      CONFIG: { SNAPSHOT_SPACE: 'polyfactory.eth' },
    });
    expect(m._space()).toBe('dao.wpmix.net');
  });

  test('_chainId() defaults to "97"', () => {
    const m = loadSnapshotStorage({ CONFIG: {} });
    expect(m._chainId()).toBe('97');
  });

  test('_chainId() reads CHAIN_ID from CONFIG', () => {
    const m = loadSnapshotStorage({ CONFIG: { CHAIN_ID: 56 } });
    expect(m._chainId()).toBe('56');
  });
});

// ─── EIP-712 types ────────────────────────────────────────────────────────────

describe('SNAPSHOT_ORDER_TYPES — structure', () => {
  const m = loadSnapshotStorage();
  const types = m.SNAPSHOT_ORDER_TYPES;

  test('has Order key', () => {
    expect(types).toHaveProperty('Order');
    expect(Array.isArray(types.Order)).toBe(true);
  });

  test('Order has exactly 9 fields', () => {
    expect(types.Order).toHaveLength(9);
  });

  test('required fields are present', () => {
    const names = types.Order.map(f => f.name);
    for (const required of ['from','space','timestamp','marketId','side','price','amount','txHash','network']) {
      expect(names).toContain(required);
    }
  });

  test('"from" field is type address', () => {
    const field = types.Order.find(f => f.name === 'from');
    expect(field.type).toBe('address');
  });

  test('"timestamp" field is type uint64', () => {
    const field = types.Order.find(f => f.name === 'timestamp');
    expect(field.type).toBe('uint64');
  });

  test('domain is { name: "snapshot", version: "0.1.4" }', () => {
    expect(m.SNAPSHOT_ORDER_DOMAIN).toEqual({ name: 'snapshot', version: '0.1.4' });
  });

  test('SHA256 of types matches snapshot-hub ORDER_TYPES_HASH', () => {
    const { createHash } = require('crypto');
    const hash = createHash('sha256').update(JSON.stringify(types)).digest('hex');
    // Must match ORDER_TYPES_HASH in snapshot-hub src/ingestor/typedData/index.ts
    expect(hash).toBe('56dcb9c7a34e6235f7788af0ec44401050ded3ecc8349bfcc0d988d9877f40eb');
  });
});

// ─── snapshotLoadOrders ───────────────────────────────────────────────────────

describe('snapshotLoadOrders — GraphQL query builder', () => {
  test('calls /graphql endpoint on hub URL', async () => {
    let capturedUrl = null;
    let capturedBody = null;
    const fetch = (url, opts) => {
      capturedUrl = url;
      capturedBody = JSON.parse(opts.body);
      return Promise.resolve({ json: () => ({ data: { orders: [] } }) });
    };
    const m = loadSnapshotStorage({ CONFIG: { SNAPSHOT_HUB_URL: 'http://hub:3700' }, fetch });
    await m.snapshotLoadOrders('0xABC', '42');
    expect(capturedUrl).toBe('http://hub:3700/graphql');
    expect(capturedBody.query).toContain('orders(');
  });

  test('query includes voter address lowercased', async () => {
    let capturedBody = null;
    const fetch = (url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return Promise.resolve({ json: () => ({ data: { orders: [] } }) });
    };
    const m = loadSnapshotStorage({ fetch });
    await m.snapshotLoadOrders('0xDEADBEEF', '5');
    expect(capturedBody.query).toContain('0xdeadbeef');
  });

  test('query includes marketId', async () => {
    let capturedBody = null;
    const fetch = (url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return Promise.resolve({ json: () => ({ data: { orders: [] } }) });
    };
    const m = loadSnapshotStorage({ fetch });
    await m.snapshotLoadOrders('0xABC', '99');
    expect(capturedBody.query).toContain('99');
  });

  test('returns [] on fetch error (non-fatal)', async () => {
    const fetch = () => Promise.reject(new Error('network error'));
    const m = loadSnapshotStorage({ fetch });
    const result = await m.snapshotLoadOrders('0xABC', '1');
    expect(result).toEqual([]);
  });

  test('returns orders array from GraphQL response', async () => {
    const mockOrders = [
      { id: '0x1', voter: '0xabc', marketId: '1', side: '0', price: '6000', amount: '1000', txHash: '0x', network: '97', created: 1700000000 }
    ];
    const fetch = () => Promise.resolve({ json: () => ({ data: { orders: mockOrders } }) });
    const m = loadSnapshotStorage({ fetch });
    const result = await m.snapshotLoadOrders('0xabc', '1');
    expect(result).toEqual(mockOrders);
  });
});

// ─── snapshotRenderOrders ─────────────────────────────────────────────────────

describe('snapshotRenderOrders — DOM output', () => {
  function makeContainer() {
    let html = '';
    return { get innerHTML() { return html; }, set innerHTML(v) { html = v; } };
  }

  test('renders "no orders" message when array is empty', () => {
    const m = loadSnapshotStorage();
    const c = makeContainer();
    m.snapshotRenderOrders(c, []);
    expect(c.innerHTML).toContain('No signed orders');
  });

  test('renders table with rows for each order', () => {
    const m = loadSnapshotStorage();
    const c = makeContainer();
    const orders = [
      { id: '1', voter: '0xabc', marketId: '1', side: '0', price: '6000', amount: '1000000000000000000', txHash: '0xaaa', network: '97', created: 1700000000 },
      { id: '2', voter: '0xabc', marketId: '1', side: '1', price: '4000', amount: '2000000000000000000', txHash: '0xbbb', network: '97', created: 1700000100 },
    ];
    m.snapshotRenderOrders(c, orders);
    expect(c.innerHTML).toContain('<table');
    expect(c.innerHTML).toContain('YES');
    expect(c.innerHTML).toContain('NO');
    expect(c.innerHTML).toContain('0xaaa');
    expect(c.innerHTML).toContain('0xbbb');
  });

  test('YES side renders badge-yes-sm', () => {
    const m = loadSnapshotStorage();
    const c = makeContainer();
    m.snapshotRenderOrders(c, [
      { id:'1', voter:'0x', marketId:'1', side:'0', price:'5000', amount:'1000', txHash:'0x', network:'97', created: 1700000000 }
    ]);
    expect(c.innerHTML).toContain('badge-yes-sm');
  });

  test('NO side renders badge-no-sm', () => {
    const m = loadSnapshotStorage();
    const c = makeContainer();
    m.snapshotRenderOrders(c, [
      { id:'1', voter:'0x', marketId:'1', side:'1', price:'5000', amount:'1000', txHash:'0x', network:'97', created: 1700000000 }
    ]);
    expect(c.innerHTML).toContain('badge-no-sm');
  });

  test('renders null/undefined orders as empty', () => {
    const m = loadSnapshotStorage();
    const c = makeContainer();
    m.snapshotRenderOrders(c, null);
    expect(c.innerHTML).toContain('No signed orders');
  });
});
