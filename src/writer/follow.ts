import { getAddress } from '@ethersproject/address';
import db from '../helpers/mysql';

export async function verify(): Promise<any> {
  return true;
}

export async function action(message, ipfs, receipt, id): Promise<void> {
  const follower = getAddress(message.from);
  const space = message.space;
  const created = message.timestamp;
  await db.queryAsync(
    `INSERT INTO follows (id, ipfs, follower, space, created)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (id) DO NOTHING`,
    [id, ipfs, follower, space, created]
  );
  console.log(`[writer] Stored: ${message.from} follow ${message.space}`);
}
