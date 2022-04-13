import { shortStringArrToStr } from '@snapshot-labs/sx';
import { validateAndParseAddress } from 'starknet/utils/address';
import { getJSON, toAddress } from './utils';

export async function handleDeploy({ source, block, tx, mysql }) {
  console.log('Handle deploy');
  const item = {
    id: validateAndParseAddress(source.contract),
    name: 'Pistachio DAO',
    voting_delay: 3600,
    voting_period: 86400,
    proposal_threshold: 1,
    proposal_count: 0,
    vote_count: 0,
    created: block.timestamp,
    tx: tx.transaction_hash
  };
  const query = `INSERT IGNORE INTO spaces SET ?;`;
  await mysql.queryAsync(query, [item]);
}

export async function handlePropose({ block, tx, receipt, mysql }) {
  console.log('Handle propose', receipt.events);
  const space = validateAndParseAddress(receipt.events[0].from_address);
  const proposal = BigInt(receipt.events[0].data[0]).toString();
  const author = toAddress(receipt.events[0].data[1]);
  let title = '';
  let body = '';
  let discussion = '';

  let metadataUri = '';
  try {
    const metadataUriLen = BigInt(receipt.events[0].data[6]).toString();
    const metadataUriArr = receipt.events[0].data.slice(7, 7 + metadataUriLen);
    metadataUri = shortStringArrToStr(metadataUriArr.map(m => BigInt(m)));
  } catch (e) {
    console.log(e);
  }

  try {
    const metadata: any = await getJSON(metadataUri);
    console.log('Metadata', metadata);
    if (metadata.title) title = metadata.title;
    if (metadata.body) body = metadata.body;
    if (metadata.discussion) discussion = metadata.discussion;
  } catch (e) {
    console.log(JSON.stringify(e).slice(0, 256));
  }

  const item = {
    id: `${space}/${proposal}`,
    proposal_id: proposal,
    space,
    author,
    execution_hash: receipt.events[0].data[2],
    metadata_uri: metadataUri,
    title,
    body,
    discussion,
    start: BigInt(receipt.events[0].data[3]).toString(),
    end: BigInt(receipt.events[0].data[4]).toString(),
    snapshot: BigInt(receipt.events[0].data[5]).toString(),
    created: block.timestamp,
    tx: tx.transaction_hash,
    vote_count: 0
  };

  const user = {
    id: author,
    created: block.timestamp
  };

  const query = `
    INSERT IGNORE INTO proposals SET ?;
    UPDATE spaces SET proposal_count = proposal_count + 1 WHERE id = ? LIMIT 1;
    INSERT IGNORE INTO users SET ?;
    UPDATE users SET proposal_count = proposal_count + 1 WHERE id = ? LIMIT 1;
  `;
  await mysql.queryAsync(query, [item, item.space, user, author]);
}

export async function handleVote({ block, receipt, mysql }) {
  console.log('Handle vote', receipt.events);
  const space = validateAndParseAddress(receipt.events[0].from_address);
  const proposal = BigInt(receipt.events[0].data[0]).toString();
  const voter = toAddress(receipt.events[0].data[1]);
  const choice = BigInt(receipt.events[0].data[2]).toString();
  const vp = BigInt(receipt.events[0].data[3]).toString();

  const item = {
    id: `${space}/${proposal}/${voter}`,
    space,
    proposal,
    voter,
    choice,
    vp,
    created: block.timestamp
  };

  const user = {
    id: voter,
    created: block.timestamp
  };

  const query = `
    INSERT IGNORE INTO votes SET ?;
    UPDATE spaces SET vote_count = vote_count + 1 WHERE id = ? LIMIT 1;
    UPDATE proposals SET vote_count = vote_count + 1, scores_total = scores_total + ?, scores_${item.choice} = scores_${item.choice} + ? WHERE id = ? LIMIT 1;
    INSERT IGNORE INTO users SET ?;
    UPDATE users SET vote_count = vote_count + 1 WHERE id = ? LIMIT 1;
  `;
  await mysql.queryAsync(query, [
    item,
    item.space,
    item.vp,
    item.vp,
    `${item.space}/${item.proposal}`,
    user,
    voter
  ]);
}
