import db from '../../helpers/mysql';
import { formatOrder } from './orders';

export default async function(parent, args, context?, info?) {
  const { id } = args;
  if (!id) return null;

  let orders: any[] = [];
  try {
    orders = await db.queryAsync('SELECT * FROM orders WHERE id = $1', [id]);
  } catch (e) {
    console.log('[graphql order]', e);
    return Promise.reject('request failed');
  }

  return orders[0] ? formatOrder(orders[0]) : null;
}
