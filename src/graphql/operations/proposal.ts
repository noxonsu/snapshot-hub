import db from '../../helpers/mysql';
import { formatProposal } from '../helpers';

export default async function(parent, { id, userWallet }) {
  console.log('>>> proposal info', id, userWallet)
  const query = `
    SELECT p.*, spaces.settings FROM proposals p
    INNER JOIN spaces ON spaces.id = p.space
    WHERE p.id = ? AND spaces.settings IS NOT NULL
    LIMIT 1
  `;
  try {
    const proposals = await db.queryAsync(query, [id]);
    const proposal = proposals.map(proposal => formatProposal(proposal))[0] || null;
    if (proposal) {
      console.log('>>> IS WHITE LIST', proposal)
      let whitelist: any = false
      try {
        whitelist = JSON.parse(proposal?.whitelist)
      } catch (e) {}
      console.log('>>> whitelist', whitelist)
      // @ts-ignore
      if (whitelist && whitelist.length) {
        proposal.whitelisted = true
        if (userWallet && whitelist.indexOf(userWallet.toLowerCase()) != -1) {
          proposal.whitelist_allowed = true
        } else {
          proposal.whitelist_allowed = false
        }
      } else {
        proposal.whitelisted = false
        proposal.whitelist_allowed = true
      }
    }
    console.log('>>> FIXED')
    console.log(proposal)
    return proposal
  } catch (e) {
    console.log('[graphql]', e);
    return Promise.reject('request failed');
  }
}
