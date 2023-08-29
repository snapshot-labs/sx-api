import { formatUnits } from '@ethersproject/units';
import { CallData, shortString, validateAndParseAddress } from 'starknet';
import { utils } from '@snapshot-labs/sx';
import EncodersAbi from './abis/encoders.json';
import { getJSON, getSpaceName } from './utils';
import type { AsyncMySqlPool, CheckpointWriter } from '@snapshot-labs/checkpoint';

const PROPOSITION_POWER_PROPOSAL_VALIDATION_STRATEGY =
  '0x190706f7d2e7ad757b9fda6867c9de43f13d6012832b922c7db8d2a509b2358';
const encodersAbi = new CallData(EncodersAbi);

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
    metadata: null as string | null,
    controller: validateAndParseAddress(event.owner),
    voting_delay: BigInt(event.voting_delay).toString(),
    min_voting_period: BigInt(event.min_voting_duration).toString(),
    max_voting_period: BigInt(event.max_voting_duration).toString(),
    proposal_threshold: 0, // TODO: read from proposal validation
    strategies: JSON.stringify(strategies),
    strategies_params: JSON.stringify(strategiesParams),
    strategies_metadata: JSON.stringify(strategiesMetadataUris),
    authenticators: JSON.stringify(event.authenticators),
    validation_strategy: event.proposal_validation_strategy.address,
    validation_strategy_params: event.proposal_validation_strategy.params.join(','),
    voting_power_validation_strategy_strategies: JSON.stringify([]),
    voting_power_validation_strategy_strategies_params: JSON.stringify([]),
    proposal_count: 0,
    vote_count: 0,
    created: block?.timestamp ?? Date.now(),
    tx: tx.transaction_hash
  };

  if (
    utils.encoding.hexPadLeft(event.proposal_validation_strategy.address) ===
    utils.encoding.hexPadLeft(PROPOSITION_POWER_PROPOSAL_VALIDATION_STRATEGY)
  ) {
    const parsed = encodersAbi.parse(
      'proposition_power_params',
      event.proposal_validation_strategy.params
    ) as Record<string, any>;

    if (Object.keys(parsed).length !== 0) {
      item.proposal_threshold = parsed.proposal_threshold;
      item.voting_power_validation_strategy_strategies = JSON.stringify(
        parsed.allowed_strategies.map(strategy => `0x${strategy.address.toString(16)}`)
      );
      item.voting_power_validation_strategy_strategies_params = JSON.stringify(
        parsed.allowed_strategies.map(strategy =>
          strategy.params.map(param => `0x${param.toString(16)}`).join(',')
        )
      );
    }
  }
  try {
    const metadataUri = longStringToText(event.metadata_URI || []).replaceAll('\x00', '');
    await handleSpaceMetadata(item.id, metadataUri, mysql);

    item.metadata = metadataUri;
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
    await handleSpaceMetadata(space, metadataUri, mysql);

    const query = `UPDATE spaces SET metadata = ? WHERE id = ? LIMIT 1;`;
    await mysql.queryAsync(query, [metadataUri, space]);
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

  const created = block?.timestamp ?? Date.now();

  const item = {
    id: `${space}/${proposal}`,
    proposal_id: proposal,
    space,
    author,
    metadata: null as string | null,
    execution_hash: event.proposal.execution_hash,
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

  try {
    const metadataUri = longStringToText(event.metadata_URI);
    await handleProposalMetadata(metadataUri, mysql);

    item.metadata = metadataUri;
  } catch (e) {
    console.log(JSON.stringify(e).slice(0, 256));
  }

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

export const handleCancel: CheckpointWriter = async ({ rawEvent, event, mysql }) => {
  if (!rawEvent || !event) return;

  console.log('Handle cancel');

  const space = validateAndParseAddress(rawEvent.from_address);
  const proposalId = `${space}/${parseInt(event.proposal_id)}`;

  const [{ vote_count }] = await mysql.queryAsync(
    `SELECT vote_count FROM proposals WHERE id = ? LIMIT 1`,
    [proposalId]
  );

  const query = `
    UPDATE proposals SET cancelled = true WHERE id = ? LIMIT 1;
    UPDATE spaces SET proposal_count = proposal_count - 1, vote_count = vote_count - ? WHERE id = ? LIMIT 1;
  `;

  await mysql.queryAsync(query, [proposalId, vote_count, space]);
};

export const handleUpdate: CheckpointWriter = async ({ block, rawEvent, event, mysql }) => {
  if (!rawEvent || !event) return;

  console.log('Handle update');

  const space = validateAndParseAddress(rawEvent.from_address);
  const proposalId = `${space}/${parseInt(event.proposal_id)}`;
  const metadataUri = longStringToText(event.metadata_URI);

  try {
    await handleProposalMetadata(metadataUri, mysql);

    const query = `UPDATE proposals SET metadata = ?, edited = ? WHERE id = ? LIMIT 1;`;
    await mysql.queryAsync(query, [metadataUri, block?.timestamp ?? Date.now(), proposalId]);
  } catch (e) {
    console.log('failed to update proposal metadata', e);
  }
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

async function handleSpaceMetadata(space: string, metadataUri: string, mysql: AsyncMySqlPool) {
  const metadataItem = {
    id: metadataUri,
    name: getSpaceName(space),
    about: '',
    external_url: '',
    github: '',
    twitter: '',
    discord: '',
    wallet: ''
  };

  const metadata: any = metadataUri ? await getJSON(metadataUri) : {};

  if (metadata.name) metadataItem.name = metadata.name;
  if (metadata.description) metadataItem.about = metadata.description;
  if (metadata.external_url) metadataItem.external_url = metadata.external_url;

  if (metadata.properties) {
    if (metadata.properties.github) metadataItem.github = metadata.properties.github;
    if (metadata.properties.twitter) metadataItem.twitter = metadata.properties.twitter;
    if (metadata.properties.discord) metadataItem.discord = metadata.properties.discord;
    if (metadata.properties.wallets && metadata.properties.wallets.length > 0) {
      metadataItem.wallet = metadata.properties.wallets[0];
    }
  }

  const query = `INSERT IGNORE INTO spacemetadataitems SET ?;`;
  await mysql.queryAsync(query, [metadataItem]);
}

async function handleProposalMetadata(metadataUri: string, mysql: AsyncMySqlPool) {
  const metadataItem = {
    id: metadataUri,
    title: '',
    body: '',
    discussion: '',
    execution: ''
  };

  const metadata: any = await getJSON(metadataUri);
  if (metadata.title) metadataItem.title = metadata.title;
  if (metadata.body) metadataItem.body = metadata.body;
  if (metadata.discussion) metadataItem.discussion = metadata.discussion;
  if (metadata.execution) metadataItem.execution = JSON.stringify(metadata.execution);

  const query = `INSERT IGNORE INTO proposalmetadataitems SET ?;`;
  await mysql.queryAsync(query, [metadataItem]);
}
