import { getAddress } from '@ethersproject/address';
import { jsonParse } from '../helpers/utils';
import db from '../helpers/mysql';

export async function verify(body): Promise<any> {
  const msg = jsonParse(body.msg);
  const payload = (msg && msg.payload) ? msg.payload : msg;

  if (!payload.marketId || String(payload.marketId).trim() === '')
    return Promise.reject('missing marketId');

  if (!payload.txHash || String(payload.txHash).trim() === '')
    return Promise.reject('missing txHash');

  if (String(payload.network) !== '97')
    return Promise.reject('wrong network');
}

export async function action(body, ipfs, receipt, id): Promise<void> {
  const msg = jsonParse(body.msg);
  const voter = getAddress(body.address);
  const payload = (msg && msg.payload) ? msg.payload : msg;

  // Store in messages table (consistent with all other types)
  await db.queryAsync(
    `INSERT INTO messages (id, ipfs, address, version, "timestamp", space, type, sig, receipt)
     VALUES ($1, $2, $3, $4, $5, $6, 'order', $7, $8)
     ON CONFLICT (id) DO NOTHING`,
    [
      id,
      ipfs || '',
      voter,
      msg.version || '0.1.4',
      msg.timestamp,
      msg.space || 'polyfactory.eth',
      body.sig,
      receipt || ''
    ]
  );

  // Store in dedicated orders table
  await db.queryAsync(
    `INSERT INTO orders (id, ipfs, voter, created, space, market_id, side, price, amount, tx_hash, network, sig)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     ON CONFLICT (id) DO NOTHING`,
    [
      id,
      ipfs || '',
      voter,
      parseInt(msg.timestamp),
      msg.space || 'polyfactory.eth',
      String(payload.marketId),
      parseInt(payload.side) || 0,
      String(payload.price),
      String(payload.amount),
      String(payload.txHash),
      String(payload.network),
      body.sig
    ]
  );

  console.log('[writer] Store order complete', msg.space, id, voter);
}
