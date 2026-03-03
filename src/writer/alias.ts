import { getAddress } from '@ethersproject/address';
import db from '../helpers/mysql';

export async function verify(message): Promise<any> {
  return message.from !== message.alias;
}

export async function action(message, ipfs, receipt, id): Promise<void> {
  const address = getAddress(message.from);
  const alias = getAddress(message.alias);
  const created = message.timestamp;
  await db.queryAsync(
    `INSERT INTO aliases (id, ipfs, address, alias, created)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (id) DO NOTHING`,
    [id, ipfs, address, alias, created]
  );
  console.log(`[writer] Stored: ${message.from} alias ${message.alias}`);
}
