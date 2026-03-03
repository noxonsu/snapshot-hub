import { getProposal } from '../helpers/adapters/mysql';
import { spaces } from '../helpers/spaces';
import { jsonParse } from '../helpers/utils';
import db from '../helpers/mysql';

export async function verify(body): Promise<any> {
  const msg = jsonParse(body.msg);
  const proposal = await getProposal(msg.space, msg.payload.proposal);

  const admins = (spaces[msg.space]?.admins || []).map(admin =>
    admin.toLowerCase()
  );
  if (
    !admins.includes(body.address.toLowerCase()) &&
    proposal.author !== body.address
  )
    return Promise.reject('wrong signer');
}

export async function action(body): Promise<void> {
  const msg = jsonParse(body.msg);
  const id = msg.payload.proposal;

  const ts = parseInt((Date.now() / 1e3).toFixed());
  const eventId = `proposal/${id}`;

  await db.queryAsync(
    `UPDATE messages SET type = ? WHERE ctid = (SELECT ctid FROM messages WHERE id = ? AND type = 'proposal' LIMIT 1)`,
    ['archive-proposal', id]
  );

  await db.queryAsync(
    `DELETE FROM proposals WHERE ctid = (SELECT ctid FROM proposals WHERE id = ? LIMIT 1)`,
    [id]
  );

  await db.queryAsync(
    `DELETE FROM votes WHERE proposal = ?`,
    [id]
  );

  await db.queryAsync(
    `DELETE FROM events WHERE id = ?`,
    [eventId]
  );

  await db.queryAsync(
    `INSERT INTO events (id, space, event, expire)
     VALUES (?, ?, ?, ?)
     ON CONFLICT DO NOTHING`,
    [eventId, msg.space, 'proposal/deleted', ts]
  );
}
