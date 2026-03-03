import db from '../../helpers/mysql';
import { buildWhereQuery } from '../helpers';

export default async function(parent, args, context?, info?) {
  const { where = {} } = args;

  // Map GraphQL camelCase field names to DB snake_case columns
  const fields = {
    id:         'string',
    voter:      'string',
    space:      'string',
    market_id:  'string',
    created:    'number'
  };

  // Remap camelCase where keys to snake_case for buildWhereQuery
  const dbWhere: any = {};
  if (where.id)              dbWhere.id = where.id;
  if (where.id_in)           dbWhere.id_in = where.id_in;
  if (where.voter)           dbWhere.voter = where.voter;
  if (where.voter_in)        dbWhere.voter_in = where.voter_in;
  if (where.space)           dbWhere.space = where.space;
  if (where.space_in)        dbWhere.space_in = where.space_in;
  if (where.market_id)       dbWhere.market_id = where.market_id;
  if (where.market_id_in)    dbWhere.market_id_in = where.market_id_in;
  if (where.created_gt)      dbWhere.created_gt = where.created_gt;
  if (where.created_lt)      dbWhere.created_lt = where.created_lt;

  const whereQuery = buildWhereQuery(fields, 'o', dbWhere);
  const queryStr = whereQuery.query;
  const params: any[] = whereQuery.params;

  const allowedOrderBy = ['created', 'market_id', 'side', 'price'];
  let orderBy = args.orderBy || 'created';
  let orderDirection = args.orderDirection || 'desc';
  if (!allowedOrderBy.includes(orderBy)) orderBy = 'created';
  orderBy = `o.${orderBy}`;
  orderDirection = orderDirection.toUpperCase();
  if (!['ASC', 'DESC'].includes(orderDirection)) orderDirection = 'DESC';

  let { first = 20 } = args;
  const { skip = 0 } = args;
  if (first > 1000) first = 1000;
  params.push(skip, first);

  const query = `
    SELECT o.* FROM orders o
    WHERE 1=1 ${queryStr}
    ORDER BY ${orderBy} ${orderDirection} OFFSET $${params.length - 1} LIMIT $${params.length}
  `;

  let orders: any[] = [];
  try {
    orders = await db.queryAsync(query, params);
    orders = orders.map(formatOrder);
  } catch (e) {
    console.log('[graphql orders]', e);
    return Promise.reject('request failed');
  }

  return orders;
}

export function formatOrder(order: any) {
  return {
    id:        order.id,
    ipfs:      order.ipfs || '',
    voter:     order.voter,
    created:   order.created,
    space:     order.space,
    marketId:  order.market_id,
    side:      order.side,
    price:     order.price,
    amount:    order.amount,
    txHash:    order.tx_hash,
    network:   order.network,
    sig:       order.sig
  };
}
