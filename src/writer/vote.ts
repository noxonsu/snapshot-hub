import snapshot from '@snapshot-labs/snapshot.js';
import { getAddress } from '@ethersproject/address';
import { jsonParse } from '../helpers/utils';
import { getProposal } from '../helpers/adapters/mysql';
import db from '../helpers/mysql';

export async function verify(body): Promise<any> {
  const msg = jsonParse(body.msg);

  const schemaIsValid = snapshot.utils.validateSchema(
    snapshot.schemas.vote,
    msg.payload
  );
  if (schemaIsValid !== true) {
    console.log('[writer] Wrong vote format', schemaIsValid);
    return Promise.reject('wrong vote format');
  }

  const proposal = await getProposal(msg.space, msg.payload.proposal);
  if (!proposal) return Promise.reject('unknown proposal');
  if (proposal?.whitelist) {
    try {
      const whitelisted = JSON.parse(proposal?.whitelist)
      if (whitelisted && whitelisted.length) {
        if (whitelisted.indexOf(body.address.toLowerCase()) == -1) {
          return Promise.reject('not in whitelist')
        }
      }
    } catch (e) {
      console.log('>> CHECK VOTE WHITELIST ERROR', e)
      return Promise.reject('check whitelist error')
    }
  }

  const tsInt = (Date.now() / 1e3).toFixed();
  const msgTs = parseInt(msg.timestamp);
  if (
    msgTs > proposal.end ||
    proposal.start > msgTs ||
    tsInt > proposal.end ||
    proposal.start > tsInt
  )
    return Promise.reject('not in voting window');

  if (
    (!proposal.type ||
      proposal.type === 'single-choice' ||
      proposal.type === 'basic') &&
    typeof msg.payload.choice !== 'number'
  )
    return Promise.reject('invalid choice');

  if (
    ['approval', 'ranked-choice'].includes(proposal.type) &&
    !Array.isArray(msg.payload.choice)
  )
    return Promise.reject('invalid choice');

  if (['weighted', 'quadratic'].includes(proposal.type)) {
    if (typeof msg.payload.choice !== 'object')
      return Promise.reject('invalid choice');

    let choiceIsValid = true;
    Object.values(msg.payload.choice).forEach(value => {
      if (typeof value !== 'number' || value < 0) choiceIsValid = false;
    });
    if (!choiceIsValid) return Promise.reject('invalid choice');
  }

  try {
    const scores = await snapshot.utils.getScores(
      msg.space,
      jsonParse(proposal.strategies),
      proposal.network,
      [body.address],
      proposal.snapshot
    );
    const totalScore = scores
      .map((score: any) => Object.values(score).reduce((a, b: any) => a + b, 0))
      .reduce((a, b: any) => a + b, 0);
    if (totalScore === 0) return Promise.reject('no voting power');
  } catch (e) {
    console.log(
      '[writer] Failed to check voting power (vote)',
      msg.space,
      body.address,
      proposal.snapshot,
      e
    );
    return Promise.reject('failed to check voting power');
  }
}

export async function action(body, ipfs, receipt, id): Promise<void> {
  const msg = jsonParse(body.msg);
  const voter = getAddress(body.address);
  const params = {
    id,
    ipfs,
    voter,
    created: parseInt(msg.timestamp),
    space: msg.space,
    proposal: msg.payload.proposal,
    choice: JSON.stringify(msg.payload.choice),
    metadata: JSON.stringify(msg.payload.metadata || {}),
    vp: 0,
    vp_by_strategy: JSON.stringify([]),
    vp_state: '',
    cb: 0
  };

  // Check if voter already voted
  const votes = await db.queryAsync(
    'SELECT id, created FROM votes WHERE voter = ? AND proposal = ? ORDER BY created DESC LIMIT 1',
    [voter, msg.payload.proposal]
  );

  // Reject vote with later timestamp
  if (votes[0]) {
    if (votes[0].created > parseInt(msg.timestamp)) {
      return Promise.reject('already voted at later time');
    } else if (votes[0].created === parseInt(msg.timestamp)) {
      const localCompare = id.localeCompare(votes[0].id);
      if (localCompare <= 0)
        return Promise.reject('already voted same time with lower index');
    }
  }

  //

  // Store message
  await db.queryAsync(
    `INSERT INTO messages (id, ipfs, address, version, "timestamp", space, type, sig, receipt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO NOTHING`,
    [id, ipfs, voter, msg.version, msg.timestamp, msg.space, 'vote', body.sig, receipt]
  );

  // Store vote in dedicated table
  await db.queryAsync(
    `INSERT INTO votes (id, ipfs, voter, created, space, proposal, choice, metadata, vp, vp_by_strategy, vp_state, cb)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO NOTHING`,
    [params.id, params.ipfs, params.voter, params.created, params.space, params.proposal, params.choice, params.metadata, params.vp, params.vp_by_strategy, params.vp_state, params.cb]
  );
  console.log('[writer] Store vote complete', msg.space, id, ipfs);
}
