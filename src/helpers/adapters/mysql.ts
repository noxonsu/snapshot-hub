import snapshot from '@snapshot-labs/snapshot.js';
import fleek from '@fleekhq/fleek-storage-js';
import db from '../mysql';
import { getSpace } from '../ens';
import { spaceIdsFailed } from '../spaces';

export async function addOrUpdateSpace(space: string, settings: any) {
  if (!settings || !settings.name) return false;
  const ts = (Date.now() / 1e3).toFixed();
  const query = `
    INSERT INTO spaces (id, created_at, updated_at, settings)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (id) DO UPDATE SET updated_at = $5, settings = $6
  `;
  await db.queryAsync(query, [
    space,
    ts,
    ts,
    JSON.stringify(settings),
    ts,
    JSON.stringify(settings)
  ]);
}

export async function loadSpace(id) {
  let space = false;
  try {
    const result = await getSpace(id);
    if (snapshot.utils.validateSchema(snapshot.schemas.space, result))
      space = result;
    console.log('Load space', id);
  } catch (e) {
    console.log('Load space failed', id);
  }
  return space;
}

export async function storeSettings(space, body) {
  const msg = JSON.parse(body.msg);

  const key = `registry/${body.address}/${space}`;
  const result = await fleek.upload({
    apiKey: process.env.FLEEK_API_KEY || '',
    apiSecret: process.env.FLEEK_API_SECRET || '',
    bucket: process.env.FLEEK_BUCKET || 'snapshot-team-bucket',
    key,
    data: JSON.stringify(msg.payload)
  });
  const ipfsHash = result.hashV0;
  console.log('Settings updated', space, ipfsHash);

  await addOrUpdateSpace(space, msg.payload);
}

export async function getProposals() {
  const ts = parseInt((Date.now() / 1e3).toFixed());
  const query = `
    SELECT space, COUNT(id) AS count,
    COUNT(CASE WHEN "start" < $1 AND "end" > $2 THEN 1 END) AS active,
    COUNT(CASE WHEN created > (EXTRACT(EPOCH FROM NOW())::int - 86400) THEN 1 END) AS count_1d
    FROM proposals GROUP BY space
  `;
  return await db.queryAsync(query, [ts, ts]);
}

export async function getFollowers() {
  const query = `
    SELECT space, COUNT(id) as count, COUNT(CASE WHEN created > (EXTRACT(EPOCH FROM NOW())::int - 86400) THEN 1 END) as count_1d FROM follows GROUP BY space
  `;
  return await db.queryAsync(query);
}

export async function getOneDayVoters() {
  const query = `
    SELECT space, COUNT(DISTINCT voter) AS count FROM votes
    WHERE created > (EXTRACT(EPOCH FROM NOW())::int - 86400) GROUP BY space
  `;
  return await db.queryAsync(query);
}

export async function loadSpaces() {
  console.time('loadSpaces');
  const query = 'SELECT id FROM spaces';
  let result = [];
  try {
    result = await db.queryAsync(query);
  } catch (e) {
    console.log(e);
  }
  const ids = result.map((space: any) => space.id);
  console.log('Spaces from db', ids.length);
  const _spaces = {};
  const max = 25;
  const pages = Math.ceil(ids.length / max);
  for (let i = 0; i < pages; i++) {
    const pageIds = ids.slice(max * i, max * (i + 1));
    const pageSpaces = await Promise.all(pageIds.map(id => loadSpace(id)));
    pageIds.forEach((id, index) => {
      if (pageSpaces[index]) {
        _spaces[id] = pageSpaces[index];
        addOrUpdateSpace(id, pageSpaces[index]);
      } else {
        spaceIdsFailed.push(id);
      }
    });
  }
  console.timeEnd('loadSpaces');
  return _spaces;
}

export async function getProposal(space, id) {
  const query = `SELECT * FROM proposals WHERE space = $1 AND id = $2`;
  const proposals = await db.queryAsync(query, [space, id]);
  return proposals[0];
}

export async function storeOrder(params: {
  id: string;
  ipfs: string;
  voter: string;
  created: number;
  space: string;
  marketId: string;
  side: number;
  price: string;
  amount: string;
  txHash: string;
  network: string;
  sig: string;
}): Promise<void> {
  await db.queryAsync(
    `INSERT INTO orders (id, ipfs, voter, created, space, market_id, side, price, amount, tx_hash, network, sig)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     ON CONFLICT (id) DO NOTHING`,
    [
      params.id,
      params.ipfs || '',
      params.voter,
      params.created,
      params.space,
      params.marketId,
      params.side,
      params.price,
      params.amount,
      params.txHash,
      params.network,
      params.sig
    ]
  );
}

export async function getOrders(filters: {
  voter?: string;
  voter_in?: string[];
  space?: string;
  space_in?: string[];
  market_id?: string;
  market_id_in?: string[];
  created_gt?: number;
  created_lt?: number;
  first?: number;
  skip?: number;
  orderBy?: string;
  orderDirection?: string;
} = {}): Promise<any[]> {
  const conditions: string[] = [];
  const params: any[] = [];

  if (filters.voter) {
    params.push(filters.voter);
    conditions.push(`voter = $${params.length}`);
  }
  if (filters.voter_in && filters.voter_in.length > 0) {
    params.push(filters.voter_in);
    conditions.push(`voter = ANY($${params.length})`);
  }
  if (filters.space) {
    params.push(filters.space);
    conditions.push(`space = $${params.length}`);
  }
  if (filters.space_in && filters.space_in.length > 0) {
    params.push(filters.space_in);
    conditions.push(`space = ANY($${params.length})`);
  }
  if (filters.market_id) {
    params.push(filters.market_id);
    conditions.push(`market_id = $${params.length}`);
  }
  if (filters.market_id_in && filters.market_id_in.length > 0) {
    params.push(filters.market_id_in);
    conditions.push(`market_id = ANY($${params.length})`);
  }
  if (typeof filters.created_gt === 'number') {
    params.push(filters.created_gt);
    conditions.push(`created > $${params.length}`);
  }
  if (typeof filters.created_lt === 'number') {
    params.push(filters.created_lt);
    conditions.push(`created < $${params.length}`);
  }

  const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

  const allowedOrderBy = ['created', 'market_id', 'side', 'price'];
  const orderBy = allowedOrderBy.includes(filters.orderBy || '') ? filters.orderBy : 'created';
  const orderDir = (filters.orderDirection || '').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

  const first = Math.min(filters.first || 20, 1000);
  const skip = filters.skip || 0;

  params.push(skip, first);
  const query = `
    SELECT * FROM orders
    ${whereClause}
    ORDER BY ${orderBy} ${orderDir}
    OFFSET $${params.length - 1} LIMIT $${params.length}
  `;

  return await db.queryAsync(query, params);
}
