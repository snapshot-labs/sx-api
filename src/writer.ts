import { formatUnits } from '@ethersproject/units';
import { shortString, validateAndParseAddress } from 'starknet';
import { getJSON, getSpaceName, parseTimestamps } from './utils';
import type { CheckpointWriter } from '@snapshot-labs/checkpoint';

function longStringToText(array: string[]): string {
  return array.reduce((acc, slice) => acc + shortString.decodeShortString(slice), '');
}

function findVariant(value: { variant: Record<string, any> }) {
  const result = Object.entries(value.variant).find(([, v]) => typeof v !== 'undefined');
  if (!result) throw new Error('Invalid variant');

  return {
    key: result[0],
    value: result[1]
  };
}

function getVoteValue(label: string) {
  if (label === 'Against') return 0;
  if (label === 'For') return 1;
  if (label === 'Abstain') return 2;

  throw new Error('Invalid vote label');
}

export const handleSpaceDeployed: CheckpointWriter = async ({ blockNumber, event, instance }) => {
  console.log('Handle space deployed');

  if (!event) return;

  await instance.executeTemplate('Space', {
    contract: event.space_address,
    start: blockNumber
  });
};

export const handleSpaceCreated: CheckpointWriter = async ({ block, tx, event, mysql }) => {
  console.log('Handle space created');

  if (!event) return;

  const strategies = event.voting_strategies.map(strategy => strategy.address);
  const strategiesParams = event.voting_strategies.map(strategy => strategy.params.join(',')); // different format than sx-evm
  const strategiesMetadataUris = event.voting_strategy_metadata_URIs.map(array =>
    longStringToText(array)
  );

  const item = {
    id: validateAndParseAddress(event.space),
    name: getSpaceName(event.space),
    about: '',
    external_url: '',
    github: '',
    twitter: '',
    discord: '',
    wallet: '',
    controller: validateAndParseAddress(event.owner),
    voting_delay: BigInt(event.voting_delay).toString(),
    min_voting_period: BigInt(event.min_voting_duration).toString(),
    max_voting_period: BigInt(event.max_voting_duration).toString(),
    strategies: JSON.stringify(strategies),
    strategies_params: JSON.stringify(strategiesParams),
    strategies_metadata: JSON.stringify(strategiesMetadataUris),
    authenticators: JSON.stringify(event.authenticators),
    proposal_count: 0,
    vote_count: 0,
    created: block?.timestamp ?? Date.now(),
    tx: tx.transaction_hash
  };

  try {
    const metadataUri = longStringToText(event.metadata_URI || []).replaceAll('\x00', '');
    const metadata: any = metadataUri ? await getJSON(metadataUri) : {};

    if (metadata.name) item.name = metadata.name;
    if (metadata.description) item.about = metadata.description;
    if (metadata.external_url) item.external_url = metadata.external_url;

    if (metadata.properties) {
      if (metadata.properties.github) item.github = metadata.properties.github;
      if (metadata.properties.twitter) item.twitter = metadata.properties.twitter;
      if (metadata.properties.discord) item.discord = metadata.properties.discord;
      if (metadata.properties.wallets && metadata.properties.wallets.length > 0) {
        item.wallet = metadata.properties.wallets[0];
      }
    }
  } catch (e) {
    console.log('failed to parse space metadata', e);
  }

  const query = `INSERT IGNORE INTO spaces SET ?;`;
  await mysql.queryAsync(query, [item]);
};

export const handleMetadataUriUpdated: CheckpointWriter = async ({ rawEvent, event, mysql }) => {
  if (!event || !rawEvent) return;

  console.log('Handle space metadata uri updated');

  const space = validateAndParseAddress(rawEvent.from_address);

  try {
    const metadataUri = longStringToText(event.metadata_URI).replaceAll('\x00', '');
    const metadata: any = await getJSON(metadataUri);

    const query = `UPDATE spaces SET name = ?, about = ?, external_url = ?, github = ?, twitter = ?, discord = ?, wallet = ? WHERE id = ? LIMIT 1;`;
    await mysql.queryAsync(query, [
      metadata.name,
      metadata.description,
      metadata.external_url,
      metadata.properties?.github,
      metadata.properties?.twitter,
      metadata.properties?.discord,
      metadata.properties?.wallets && metadata.properties?.wallets.length > 0
        ? metadata.properties?.wallets[0]
        : '',
      space
    ]);
  } catch (e) {
    console.log('failed to update space metadata', e);
  }
};

export const handlePropose: CheckpointWriter = async ({ block, tx, rawEvent, event, mysql }) => {
  if (!rawEvent || !event) return;

  console.log('Handle propose');

  const space = validateAndParseAddress(rawEvent.from_address);
  const [{ strategies, strategies_params }] = await mysql.queryAsync(
    'SELECT strategies, strategies_params FROM spaces WHERE id = ? LIMIT 1',
    [space]
  );
  const proposal = parseInt(BigInt(event.proposal_id).toString());
  const author = findVariant(event.author).value;
  let title = '';
  let body = '';
  let discussion = '';
  let execution = '';
  let metadataUri = '';

  try {
    metadataUri = longStringToText(event.metadata_URI);
    const metadata: any = await getJSON(metadataUri);
    console.log('Metadata', metadata);
    if (metadata.title) title = metadata.title;
    if (metadata.body) body = metadata.body;
    if (metadata.discussion) discussion = metadata.discussion;
    if (metadata.execution) execution = JSON.stringify(metadata.execution);
  } catch (e) {
    console.log(JSON.stringify(e).slice(0, 256));
  }

  const created = block?.timestamp ?? Date.now();

  const item = {
    id: `${space}/${proposal}`,
    proposal_id: proposal,
    space,
    author,
    execution_hash: event.proposal.execution_hash,
    metadata_uri: metadataUri,
    title,
    body,
    discussion,
    execution,
    start: parseInt(BigInt(event.proposal.start_timestamp).toString()),
    min_end: parseInt(BigInt(event.proposal.min_end_timestamp).toString()),
    max_end: parseInt(BigInt(event.proposal.max_end_timestamp).toString()),
    snapshot: parseInt(BigInt(event.proposal.start_timestamp).toString()),
    scores_1: 0,
    scores_2: 0,
    scores_3: 0,
    scores_total: 0,
    quorum: 0, // TODO: should come from execution strategy, how to get it in L1 execution?
    strategies,
    strategies_params,
    created,
    tx: tx.transaction_hash,
    vote_count: 0
  };
  console.log('Proposal', item);

  const user = {
    id: author,
    vote_count: 0,
    proposal_count: 0,
    created
  };

  const query = `
    INSERT IGNORE INTO proposals SET ?;
    UPDATE spaces SET proposal_count = proposal_count + 1 WHERE id = ? LIMIT 1;
    INSERT IGNORE INTO users SET ?;
    UPDATE users SET proposal_count = proposal_count + 1 WHERE id = ? LIMIT 1;
  `;
  await mysql.queryAsync(query, [item, item.space, user, author]);
};

export const handleVote: CheckpointWriter = async ({ block, rawEvent, event, mysql }) => {
  if (!rawEvent || !event) return;

  console.log('Handle vote');

  const space = validateAndParseAddress(rawEvent.from_address);
  const proposal = parseInt(event.proposal_id);
  const voter = findVariant(event.voter).value;
  const choice = getVoteValue(findVariant(event.choice).key);
  const vp = parseFloat(formatUnits(BigInt(event.voting_power), 18));

  const created = block?.timestamp ?? Date.now();

  const item = {
    id: `${space}/${proposal}/${voter}`,
    space,
    proposal,
    voter,
    choice,
    vp,
    created
  };
  console.log('Vote', item);

  const user = {
    id: voter,
    vote_count: 0,
    proposal_count: 0,
    created
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
};
