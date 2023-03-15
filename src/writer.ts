import { formatUnits } from '@ethersproject/units';
import { shortStringArrToStr } from '@snapshot-labs/sx/dist/utils/strings';
import { validateAndParseAddress } from 'starknet';
import { getJSON, toAddress, getSpaceName, parseTimestamps } from './utils';
import type { CheckpointWriter } from '@snapshot-labs/checkpoint';

function intSequenceToString(intSequence) {
  const sequenceStr = shortStringArrToStr(intSequence);
  return (sequenceStr.split(/(.{9})/) || [])
    .filter(str => str !== '')
    .map(str => str.replace('\x00', '').split('').reverse().join(''))
    .join('');
}

function uint256toString(uint256) {
  return (BigInt(uint256.low) + (BigInt(uint256.high) << BigInt(128))).toString();
}

export const handleSpaceCreated: CheckpointWriter = async ({
  block,
  blockNumber,
  tx,
  event,
  knex,
  instance
}) => {
  if (!event) return;

  console.log('Handle space created');

  const item = {
    id: validateAndParseAddress(event.space_address),
    name: getSpaceName(event.space_address),
    about: '',
    external_url: '',
    github: '',
    twitter: '',
    discord: '',
    wallet: '',
    controller: validateAndParseAddress(event.controller),
    voting_delay: BigInt(event.voting_delay).toString(),
    min_voting_period: BigInt(event.min_voting_duration).toString(),
    max_voting_period: BigInt(event.max_voting_duration).toString(),
    proposal_threshold: uint256toString(event.proposal_threshold),
    quorum: uint256toString(event.quorum),
    strategies: JSON.stringify(event.voting_strategies),
    strategies_params: JSON.stringify(event.voting_strategy_params_flat),
    authenticators: JSON.stringify(event.authenticators),
    executors: JSON.stringify(event.execution_strategies),
    proposal_count: 0,
    vote_count: 0,
    created: block?.timestamp ?? Date.now(),
    tx: tx.transaction_hash
  };

  try {
    const metadataUri = shortStringArrToStr(event.metadata_uri || []).replaceAll('\x00', '');
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

  instance.executeTemplate('Space', {
    contract: item.id,
    start: blockNumber
  });

  await knex.table('spaces').insert(item).onConflict().ignore();
};

export const handleMetadataUriUpdated: CheckpointWriter = async ({ rawEvent, event, knex }) => {
  if (!event || !rawEvent) return;

  console.log('Handle space metadata uri updated');

  const space = validateAndParseAddress(rawEvent.from_address);

  try {
    const metadataUri = shortStringArrToStr(event.new_metadata_uri).replaceAll('\x00', '');
    const metadata: any = await getJSON(metadataUri);

    await knex
      .table('spaces')
      .where('id', space)
      .update({
        name: metadata.name,
        about: metadata.description,
        external_url: metadata.external_url,
        github: metadata.properties?.github,
        twitter: metadata.properties?.twitter,
        discord: metadata.properties?.discord,
        wallet:
          metadata.properties?.wallets && metadata.properties?.wallets.length > 0
            ? metadata.properties?.wallets[0]
            : ''
      });
  } catch (e) {
    console.log('failed to update space metadata', e);
  }
};

export const handlePropose: CheckpointWriter = async ({ block, tx, rawEvent, event, knex }) => {
  if (!rawEvent || !event) return;

  console.log('Handle propose');

  const space = validateAndParseAddress(rawEvent.from_address);
  const [{ strategies, strategies_params }] = await knex
    .select('strategies', 'strategies_params')
    .from('spaces')
    .where('id', space)
    .limit(1);
  const proposal = parseInt(BigInt(event.proposal_id).toString());
  const author = toAddress(event.proposer_address.value);
  let title = '';
  let body = '';
  let discussion = '';
  let execution = '';
  let metadataUri = '';

  try {
    metadataUri = intSequenceToString(event.metadata_uri);
    const metadata: any = await getJSON(metadataUri);
    console.log('Metadata', metadata);
    if (metadata.title) title = metadata.title;
    if (metadata.body) body = metadata.body;
    if (metadata.discussion) discussion = metadata.discussion;
    if (metadata.execution) execution = JSON.stringify(metadata.execution);
  } catch (e) {
    console.log(JSON.stringify(e).slice(0, 256));
  }

  const timestamps = parseTimestamps(event.proposal.timestamps);
  if (!timestamps) return;

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
    start: parseInt(BigInt(timestamps.start).toString()),
    min_end: parseInt(BigInt(timestamps.minEnd).toString()),
    max_end: parseInt(BigInt(timestamps.maxEnd).toString()),
    snapshot: parseInt(BigInt(timestamps.snapshot).toString()),
    scores_1: 0,
    scores_2: 0,
    scores_3: 0,
    scores_total: 0,
    quorum: uint256toString(event.proposal.quorum),
    strategies: JSON.stringify(strategies),
    strategies_params: JSON.stringify(strategies_params),
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

  await knex.table('proposals').insert(item).onConflict().ignore();
  await knex
    .table('spaces')
    .where('id', item.space)
    .update({ proposal_count: knex.raw('proposal_count + 1') });
  await knex.table('users').insert(user).onConflict().ignore();
  await knex
    .table('users')
    .where('id', author)
    .update({ proposal_count: knex.raw('proposal_count + 1') });
};

export const handleVote: CheckpointWriter = async ({ block, rawEvent, event, knex }) => {
  if (!rawEvent || !event) return;

  console.log('Handle vote', event);

  const space = validateAndParseAddress(rawEvent.from_address);
  const proposal = parseInt(event.proposal_id);
  const voter = toAddress(event.voter_address.value);
  const choice = parseInt(BigInt(event.vote.choice).toString());
  const vp = parseFloat(formatUnits(uint256toString(event.vote.voting_power), 18));

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

  await knex.table('votes').insert(item).onConflict().ignore();
  await knex
    .table('spaces')
    .where('id', item.space)
    .update({ vote_count: knex.raw('vote_count + 1') });
  await knex
    .table('proposals')
    .where('id', `${item.space}/${item.proposal}`)
    .update({
      vote_count: knex.raw('vote_count + 1'),
      scores_total: knex.raw('scores_total + ?', [item.vp]),
      [`scores_${item.choice}`]: knex.raw('?? + ?', [`scores_${item.choice}`, item.vp])
    });
  await knex.table('users').insert(user).onConflict().ignore();
  await knex
    .table('users')
    .where('id', voter)
    .update({ vote_count: knex.raw('vote_count + 1') });
};
