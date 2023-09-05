import { formatUnits } from '@ethersproject/units';
import { Contract as EthContract } from '@ethersproject/contracts';
import { JsonRpcProvider } from '@ethersproject/providers';
import { Contract, CallData, Provider, shortString, validateAndParseAddress } from 'starknet';
import { utils } from '@snapshot-labs/sx';
import EncodersAbi from './abis/encoders.json';
import ExecutionStrategyAbi from './abis/executionStrategy.json';
import SimpleQuorumExecutionStrategyAbi from './abis/l1/SimpleQuorumExecutionStrategy.json';
import { getJSON, getSpaceName } from './utils';
import Config from './config.json';
import type { AsyncMySqlPool, CheckpointWriter } from '@snapshot-labs/checkpoint';

const PROPOSITION_POWER_PROPOSAL_VALIDATION_STRATEGY =
  '0x120c5b7866d8c89eed24c54f4f3abac9ddf39bdda4cd75d5fc0a0eea93644bd';
const encodersAbi = new CallData(EncodersAbi);

const ethProvider = new JsonRpcProvider('http://127.0.0.1:8545');

const starkProvider = new Provider({
  rpc: {
    nodeUrl: Config.network_node_url
  }
});

function dropIpfs(metadataUri: string) {
  return metadataUri.replace('ipfs://', '');
}

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
    proposal_threshold: 0,
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

    item.metadata = dropIpfs(metadataUri);
  } catch (e) {
    console.log('failed to parse space metadata', e);
  }

  try {
    await handleStrategiesMetadata(item.id, strategiesMetadataUris, mysql);
  } catch (e) {
    console.log('failed to handle strategies metadata', e);
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
    await mysql.queryAsync(query, [dropIpfs(metadataUri), space]);
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
    execution_time: 0,
    execution_strategy: validateAndParseAddress(event.proposal.execution_strategy),
    execution_strategy_type: 'none',
    scores_1: 0,
    scores_2: 0,
    scores_3: 0,
    scores_total: 0,
    quorum: 0n,
    strategies,
    strategies_params,
    created,
    tx: tx.transaction_hash,
    execution_tx: null,
    veto_tx: null,
    vote_count: 0,
    executed: false,
    vetoed: false,
    completed: false,
    cancelled: false
  };

  const executionStrategy = await handleExecutionStrategy(
    event.proposal.execution_strategy,
    event.payload
  );
  if (executionStrategy) {
    item.execution_strategy_type = executionStrategy.executionStrategyType;
    item.quorum = executionStrategy.quorum;
  }

  try {
    const metadataUri = longStringToText(event.metadata_URI);
    await handleProposalMetadata(metadataUri, mysql);

    item.metadata = dropIpfs(metadataUri);
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
    await mysql.queryAsync(query, [
      dropIpfs(metadataUri),
      block?.timestamp ?? Date.now(),
      proposalId
    ]);
  } catch (e) {
    console.log('failed to update proposal metadata', e);
  }

  const executionStrategy = await handleExecutionStrategy(
    event.proposal.execution_strategy,
    event.payload
  );
  if (executionStrategy) {
    const query = `UPDATE proposals SET execution_strategy_type = ?, quorum = ? WHERE id = ? LIMIT 1;`;
    await mysql.queryAsync(query, [
      executionStrategy.executionStrategyType,
      executionStrategy.quorum,
      proposalId
    ]);
  }
};

export const handleExecute: CheckpointWriter = async ({ tx, rawEvent, event, mysql }) => {
  if (!rawEvent || !event) return;

  console.log('Handle execute');

  const space = validateAndParseAddress(rawEvent.from_address);
  const proposalId = `${space}/${parseInt(event.proposal_id)}`;

  const query = `UPDATE proposals SET executed = true, completed = true, execution_tx = ? WHERE id = ? LIMIT 1;`;
  await mysql.queryAsync(query, [tx.transaction_hash, proposalId]);
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
    id: dropIpfs(metadataUri),
    name: getSpaceName(space),
    about: '',
    avatar: '',
    cover: '',
    external_url: '',
    delegation_api_type: '',
    delegation_api_url: '',
    github: '',
    twitter: '',
    discord: '',
    voting_power_symbol: '',
    wallet: ''
  };

  const metadata: any = metadataUri ? await getJSON(metadataUri) : {};

  if (metadata.name) metadataItem.name = metadata.name;
  if (metadata.description) metadataItem.about = metadata.description;
  if (metadata.avatar) metadataItem.avatar = metadata.avatar;
  if (metadata.external_url) metadataItem.external_url = metadata.external_url;

  if (metadata.properties) {
    if (metadata.properties.cover) metadataItem.cover = metadata.properties.cover;
    if (
      metadata.properties.delegation_api_type === 'governor-subgraph' &&
      metadata.properties.delegation_api_url
    ) {
      metadataItem.delegation_api_type = metadata.properties.delegation_api_type;
      metadataItem.delegation_api_url = metadata.properties.delegation_api_url;
    }
    if (metadata.properties.github) metadataItem.github = metadata.properties.github;
    if (metadata.properties.twitter) metadataItem.twitter = metadata.properties.twitter;
    if (metadata.properties.discord) metadataItem.discord = metadata.properties.discord;
    if (metadata.properties.voting_power_symbol) {
      metadataItem.voting_power_symbol = metadata.properties.voting_power_symbol;
    }
    if (metadata.properties.wallets && metadata.properties.wallets.length > 0) {
      metadataItem.wallet = metadata.properties.wallets[0];
    }
  }

  const query = `INSERT IGNORE INTO spacemetadataitems SET ?;`;
  await mysql.queryAsync(query, [metadataItem]);
}

async function handleProposalMetadata(metadataUri: string, mysql: AsyncMySqlPool) {
  const metadataItem = {
    id: dropIpfs(metadataUri),
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

async function handleExecutionStrategy(address: string, payload: string[]) {
  try {
    const executionContract = new Contract(ExecutionStrategyAbi, address, starkProvider);

    const executionStrategyType = shortString.decodeShortString(
      await executionContract.get_strategy_type()
    );

    let quorum = 0n;
    if (executionStrategyType === 'SimpleQuorumVanilla') {
      quorum = await executionContract.quorum();
    } else if (executionStrategyType === 'EthRelayer') {
      const [l1Destination] = payload;

      const SimpleQuorumExecutionStrategyContract = new EthContract(
        l1Destination,
        SimpleQuorumExecutionStrategyAbi,
        ethProvider
      );

      quorum = await SimpleQuorumExecutionStrategyContract.quorum();
    }

    return {
      executionStrategyType,
      quorum
    };
  } catch (e) {
    console.log('failed to get execution strategy type', e);

    return null;
  }
}

async function handleStrategiesMetadata(
  spaceId: string,
  metadataUris: string[],
  mysql: AsyncMySqlPool
) {
  for (let i = 0; i < metadataUris.length; i++) {
    const metadataUri = metadataUris[i];

    const item = {
      id: `${spaceId}/${i}`,
      space: spaceId,
      index: i,
      data: null as string | null
    };

    if (metadataUri.startsWith('ipfs://')) {
      item.data = dropIpfs(metadataUri);

      await handleStrategiesParsedMetadata(metadataUri, mysql);
    }

    const query = `INSERT IGNORE INTO strategiesparsedmetadataitems SET ?;`;
    await mysql.queryAsync(query, [item]);
  }
}

async function handleStrategiesParsedMetadata(metadataUri: string, mysql: AsyncMySqlPool) {
  const metadataItem = {
    id: dropIpfs(metadataUri),
    name: '',
    description: '',
    decimals: 0,
    symbol: '',
    token: null
  };

  const metadata: any = await getJSON(metadataUri);
  if (metadata.name) metadataItem.name = metadata.name;
  if (metadata.description) metadataItem.description = metadata.description;

  if (metadata.properties) {
    if (metadata.properties.decimals) metadataItem.decimals = metadata.properties.decimals;
    if (metadata.properties.symbol) metadataItem.symbol = metadata.properties.symbol;
    if (metadata.properties.token) metadataItem.token = metadata.properties.token;
  }

  const query = `INSERT IGNORE INTO strategiesparsedmetadatadataitems SET ?;`;
  await mysql.queryAsync(query, [metadataItem]);
}
