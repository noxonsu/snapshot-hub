import isEqual from 'lodash/isEqual';
import snapshot from '@snapshot-labs/snapshot.js';
import { getAddress } from '@ethersproject/address';
import { jsonParse } from '../helpers/utils';
import { spaces } from '../helpers/spaces';
import db from '../helpers/mysql';

const proposalDayLimit = 32;
const proposalMonthLimit = 320;

async function getRecentProposalsCount(space) {
  const query = `
    SELECT
    COUNT(CASE WHEN created > (EXTRACT(EPOCH FROM NOW())::int - 86400) THEN 1 END) AS count_1d,
    COUNT(*) AS count_30d
    FROM proposals WHERE space = ? AND created > (EXTRACT(EPOCH FROM NOW())::int - 2592000)
  `;
  return await db.queryAsync(query, [space]);
}

export async function verify(body): Promise<any> {
  const msg = jsonParse(body.msg);

  const schemaIsValid = snapshot.utils.validateSchema(
    snapshot.schemas.proposal,
    msg.payload
  );
  if (schemaIsValid !== true) {
    console.log('[writer] Wrong proposal format', schemaIsValid);
    return Promise.reject('wrong proposal format');
  }

  if (
    msg.payload.type === 'basic' &&
    !isEqual(['For', 'Against', 'Abstain'], msg.payload.choices)
  ) {
    return Promise.reject('wrong choices for basic type voting');
  }

  const space = spaces[msg.space];
  space.id = msg.space;

  if (space.voting?.delay) {
    const isValidDelay =
      msg.payload.start === parseInt(msg.timestamp) + space.voting.delay;

    if (!isValidDelay) return Promise.reject('invalid voting delay');
  }

  if (space.voting?.period) {
    const isValidPeriod =
      msg.payload.end - msg.payload.start === space.voting.period;
    if (!isValidPeriod) return Promise.reject('invalid voting period');
  }

  try {
    const validationName = space.validation?.name || 'basic';
    const validationParams = space.validation?.params || {};
    const isValid = await snapshot.utils.validations[validationName](
      body.address,
      space,
      msg.payload,
      validationParams
    );
    if (!isValid) return Promise.reject('validation failed');
  } catch (e) {
    return Promise.reject('failed to check validation');
  }

  try {
    const [
      { count_1d: proposalsDayCount, count_30d: proposalsMonthCount }
    ] = await getRecentProposalsCount(space.id);

    if (proposalsDayCount >= proposalDayLimit) {
      return Promise.reject('daily proposal limit reached');
    }
    if (proposalsMonthCount >= proposalMonthLimit) {
      return Promise.reject('monthly proposal limit reached');
    }
  } catch (e) {
    return Promise.reject('failed to check proposals limit');
  }
}

export async function action(body, ipfs, receipt, id): Promise<void> {
  const msg = jsonParse(body.msg);
  const space = msg.space;

  await db.queryAsync(
    `INSERT INTO messages (id, ipfs, address, version, "timestamp", space, type, sig, receipt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO NOTHING`,
    [id, ipfs, body.address, msg.version, msg.timestamp, space, 'proposal', body.sig, receipt]
  );

  /* Store the proposal in dedicated table 'proposals' */
  const spaceSettings = spaces[space];
  const author = getAddress(body.address);
  const created = parseInt(msg.timestamp);
  const metadata = msg.payload.metadata || {};
  const strategies = JSON.stringify(
    metadata.strategies || spaceSettings.strategies
  );
  const plugins = JSON.stringify(metadata.plugins || {});
  const network = metadata.network || spaceSettings.network;
  const proposalSnapshot = parseInt(msg.payload.snapshot || '0');

  const proposalTitle = msg.payload.name;
  const proposalBody = msg.payload.body;
  const proposalChoices = JSON.stringify(msg.payload.choices);
  const proposalStart = parseInt(msg.payload.start || '0');
  const proposalEnd = parseInt(msg.payload.end || '0');
  const proposalSnapshotVal = proposalSnapshot || 0;
  const proposalType = msg.payload.type || 'single-choice';
  const proposalScores = JSON.stringify([]);
  const proposalScoresByStrategy = JSON.stringify([]);
  const proposalWhitelist = JSON.stringify(msg.payload.metadata.whitelist);

  await db.queryAsync(
    `INSERT INTO proposals (id, ipfs, author, created, space, network, type, strategies, plugins, title, body, choices, "start", "end", snapshot, scores, scores_by_strategy, scores_state, scores_total, scores_updated, votes, whitelist)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO NOTHING`,
    [id, ipfs, author, created, space, network, proposalType, strategies, plugins, proposalTitle, proposalBody, proposalChoices, proposalStart, proposalEnd, proposalSnapshotVal, proposalScores, proposalScoresByStrategy, '', 0, 0, 0, proposalWhitelist]
  );

  /* Store events in database */
  const eventId = `proposal/${id}`;
  const ts = Date.now() / 1e3;

  await db.queryAsync(
    `INSERT INTO events (id, space, event, expire)
     VALUES (?, ?, ?, ?)
     ON CONFLICT DO NOTHING`,
    [eventId, space, 'proposal/created', created]
  );

  await db.queryAsync(
    `INSERT INTO events (id, space, event, expire)
     VALUES (?, ?, ?, ?)
     ON CONFLICT DO NOTHING`,
    [eventId, space, 'proposal/start', proposalStart]
  );

  if (proposalEnd > ts) {
    await db.queryAsync(
      `INSERT INTO events (id, space, event, expire)
       VALUES (?, ?, ?, ?)
       ON CONFLICT DO NOTHING`,
      [eventId, space, 'proposal/end', proposalEnd]
    );
  }

  console.log('Store proposal complete', space, id);
}
