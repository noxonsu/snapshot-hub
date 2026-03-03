import snapshot from '@snapshot-labs/snapshot.js';
import hashTypes from '@snapshot-labs/snapshot.js/src/sign/types.json';
import relayer, { issueReceipt } from '../../helpers/relayer';
import envelope from './envelope.json';
import { spaces } from '../../helpers/spaces';
import writer from '../../writer';
// import gossip from '../../helpers/gossip';
import { pinJson } from '../../helpers/ipfs';
import { sha256 } from '../../helpers/utils';
import { isValidAlias } from '../../helpers/alias';
import { _TypedDataEncoder } from "@ethersproject/hash";
import { recoverPublicKey2 } from '../personalSign/utils'

const NAME = 'snapshot';
const VERSION = '0.1.4';

// Hash of Order EIP-712 types for PolyFactory CLOB orders (BSC Testnet, chainId 97)
// Computed from: sha256(JSON.stringify({ Order: [...fields] }))
const ORDER_TYPES_HASH = '56dcb9c7a34e6235f7788af0ec44401050ded3ecc8349bfcc0d988d9877f40eb';

// Legacy proposal hash (kept from original code)
const PROPOSAL_TYPES_HASH = 'fa83259e322a553b0b18285fe26580eaff64ad16541325a9f4ed18960d1f934f';

export default async function ingestor(body) {
  const schemaIsValid = snapshot.utils.validateSchema(envelope, body);
  if (schemaIsValid !== true) {
    console.log('[ingestor] Wrong envelope format', schemaIsValid);
    return Promise.reject('wrong envelope format');
  }

  const ts = Date.now() / 1e3;
  const over = 300;
  const under = 60 * 60;
  const overTs = (ts + over).toFixed();
  const underTs = (ts - under).toFixed();
  const { domain, message, types } = body.data;

  if (JSON.stringify(body).length > 19e5) {
    console.log('>>> TOO LARGE', JSON.stringify(body).length)
    return Promise.reject('too large message');
  }

  if (message.timestamp > overTs || message.timestamp < underTs)
    return Promise.reject('wrong timestamp');

  if (domain.name !== NAME || domain.version !== VERSION)
    return Promise.reject('wrong domain');

  const hash = sha256(JSON.stringify(types));

  if (
    !Object.keys(hashTypes).includes(hash) &&
    hash !== PROPOSAL_TYPES_HASH &&
    hash !== ORDER_TYPES_HASH
  )
    return Promise.reject('wrong types');

  let type = hash === PROPOSAL_TYPES_HASH ? 'proposal'
           : hash === ORDER_TYPES_HASH ? 'order'
           : hashTypes[hash];

  if (
    !['settings', 'alias', 'order'].includes(type) &&
    (!message.space || !spaces[message.space])
  )
    return Promise.reject('unknown space');

  // Check if signing address is an alias
  if (body.address !== message.from) {
    if (!['follow', 'unfollow', 'subscribe', 'unsubscribe'].includes(type))
      return Promise.reject('wrong from');

    if (!(await isValidAlias(message.from, body.address)))
      return Promise.reject('wrong alias');
  }

  // Check if signature is valid
  const isValid = await snapshot.utils.verify(
    body.address,
    body.sig,
    body.data
  );
  const id = snapshot.utils.getHash(body.data);
  if (!isValid) {
    // try WalletConnect - by signMessage check
    const sourceData = {
      domain: body.data.domain,
      types: body.data.types,
      value: body.data.message,
    }

    const jsonMsg = JSON.stringify(sourceData)

    try {
      const signer = recoverPublicKey2(body.sig, jsonMsg);
      if (body.address.toLowerCase() !== signer.toLowerCase()) {
        return Promise.reject('wrong signature');
      }
    } catch (err) {
      return Promise.reject('wrong signature');
    }
  }
  console.log('[ingestor] Signature is valid');

  let payload: any = {};

  if (type === 'settings') payload = JSON.parse(message.settings);

  if (type === 'proposal')
    payload = {
      name: message.title,
      body: message.body,
      choices: message.choices,
      start: message.start,
      end: message.end,
      snapshot: message.snapshot,
      metadata: {
        plugins: JSON.parse(message.plugins),
        network: message.network,
        strategies: JSON.parse(message.strategies),
        whitelist: JSON.parse(message?.whitelist),
        ...JSON.parse(message.metadata)
      },
      type: message.type
    };
  if (type === 'delete-proposal') payload = { proposal: message.proposal };

  if (['vote', 'vote-array', 'vote-string'].includes(type)) {
    let choice = message.choice;
    if (type === 'vote-string') choice = JSON.parse(message.choice);
    payload = {
      proposal: message.proposal,
      choice,
      metadata: JSON.parse(message.metadata)
    };
    type = 'vote';
  }

  if (type === 'order') {
    payload = {
      marketId: message.marketId,
      side:     message.side,
      price:    message.price,
      amount:   message.amount,
      txHash:   message.txHash,
      network:  message.network
    };
  }

  let legacyBody: any = {
    address: body.address,
    msg: JSON.stringify({
      version: domain.version,
      timestamp: message.timestamp,
      space: message.space || 'polyfactory.eth',
      type,
      payload
    }),
    sig: body.sig
  };

  if (
    ['follow', 'unfollow', 'alias', 'subscribe', 'unsubscribe'].includes(type)
  ) {
    legacyBody = message;
  }
  try {
    await writer[type].verify(legacyBody);
  } catch (e) {
    console.log('[ingestor]', e);
    return Promise.reject(e);
  }

  // @TODO gossip to typed data endpoint
  // gossip(body, message.space);

  // Skip IPFS pinning for order type (no Fleek/Pinata keys configured; signature is proof)
  let ipfs = '';
  let receipt = '';
  if (type !== 'order') {
    const results = await Promise.all([
      pinJson(`snapshot/${body.sig}`, body),
      issueReceipt(body.sig)
    ]);
    ipfs = results[0];
    receipt = results[1];
  }

  try {
    await writer[type].action(legacyBody, ipfs, receipt, id);
  } catch (e) {
    return Promise.reject(e);
  }

  console.log(
    '[ingestor]',
    `Address "${body.address}"\n`,
    `Space "${message.space}"\n`,
    `Type "${type}"\n`,
    `Id "${id}"\n`,
    `IPFS "${ipfs}"`
  );

  return {
    id,
    ipfs,
    relayer: {
      address: relayer.address,
      receipt
    }
  };
}
