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
  pg,
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

  const query = `
    INSERT INTO spaces(
      id, name, about, external_url, github, twitter, discord, wallet,
      controller, voting_delay, min_voting_period, max_voting_period,
      proposal_threshold, quorum, strategies, strategies_params,
      authenticators, executors, proposal_count, vote_count, created, tx
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
      $17, $18, $19, $20, $21, $22
    )
    ON CONFLICT DO NOTHING;`;
  await pg.query(query, [
    item.id,
    item.name,
    item.about,
    item.external_url,
    item.github,
    item.twitter,
    item.discord,
    item.wallet,
    item.controller,
    item.voting_delay,
    item.min_voting_period,
    item.max_voting_period,
    item.proposal_threshold,
    item.quorum,
    item.strategies,
    item.strategies_params,
    item.authenticators,
    item.executors,
    item.proposal_count,
    item.vote_count,
    item.created,
    item.tx
  ]);
};

export const handleMetadataUriUpdated: CheckpointWriter = async ({ rawEvent, event, pg }) => {
  if (!event || !rawEvent) return;

  console.log('Handle space metadata uri updated');

  const space = validateAndParseAddress(rawEvent.from_address);

  try {
    const metadataUri = shortStringArrToStr(event.new_metadata_uri).replaceAll('\x00', '');
    const metadata: any = await getJSON(metadataUri);

    const query = `UPDATE spaces SET name = $1, about = $2, external_url = $3, github = $4, twitter = $5, discord = $6, wallet = $7 WHERE id = $8;`;
    await pg.query(query, [
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

export const handlePropose: CheckpointWriter = async ({ block, tx, rawEvent, event, pg }) => {
  if (!rawEvent || !event) return;

  console.log('Handle propose');

  const space = validateAndParseAddress(rawEvent.from_address);

  const result = await pg.query(
    'SELECT strategies, strategies_params FROM spaces WHERE id = $1 LIMIT 1',
    [space]
  );
  const [{ strategies, strategies_params }] = result.rows;

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

  const insertProposalQuery = `
      INSERT INTO proposals(
        id, proposal_id, space, author, execution_hash, metadata_uri, title, body,
        discussion, execution, start, min_end, max_end, snapshot, scores_1, scores_2,
        scores_3, scores_total, quorum, strategies, strategies_params, created, tx,
        vote_count
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17,
        $18, $19, $20, $21, $22, $23, $24
      )`;
  const insertUserQuery = `
      INSERT INTO users(
        id, vote_count, proposal_count, created
      ) VALUES (
        $1, $2, $3, $4
      )`;
  const updateSpaceQuery = `UPDATE spaces SET proposal_count = proposal_count + 1 WHERE id = $1`;
  const updateUserQuery = `UPDATE users SET proposal_count = proposal_count + 1 WHERE id = $1`;

  await Promise.all([
    pg.query(insertProposalQuery, [
      item.id,
      item.proposal_id,
      item.space,
      item.author,
      item.execution_hash,
      item.metadata_uri,
      item.title,
      item.body,
      item.discussion,
      item.execution,
      item.start,
      item.min_end,
      item.max_end,
      item.snapshot,
      item.scores_1,
      item.scores_2,
      item.scores_3,
      item.scores_total,
      item.quorum,
      item.strategies,
      item.strategies_params,
      item.created,
      item.tx,
      item.vote_count
    ]),
    pg.query(insertUserQuery, [user.id, user.vote_count, user.proposal_count, user.created]),
    pg.query(updateSpaceQuery, [item.space]),
    pg.query(updateUserQuery, [item.author])
  ]);
};

export const handleVote: CheckpointWriter = async ({ block, rawEvent, event, pg }) => {
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

  const scoreIncreases = {
    1: choice === 1 ? vp : 0,
    2: choice === 2 ? vp : 0,
    3: choice === 3 ? vp : 0
  };

  const insertVoteQuery = `
    INSERT INTO votes(
      id, space, proposal, voter, choice, vp, created
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7
    ) ON CONFLICT DO NOTHING`;
  const insertUserQuery = `
    INSERT INTO users(
      id, vote_count, proposal_count, created
    ) VALUES (
      $1, $2, $3, $4
    ) ON CONFLICT DO NOTHING`;
  const updateSpaceQuery = `UPDATE spaces SET vote_count = vote_count + 1 WHERE id = $1`;
  const updateProposalQuery = `
    UPDATE proposals SET vote_count = vote_count + 1, scores_total = scores_total + $1,
    scores_1 = scores_1 + $2, scores_2 = scores_2 + $3, scores_3 = scores_3 + $4 WHERE id = $5`;
  const updateUserQuery = `UPDATE users SET vote_count = vote_count + 1 WHERE id = $1`;

  await Promise.all([
    pg.query(insertVoteQuery, [
      item.id,
      item.space,
      item.proposal,
      item.voter,
      item.choice,
      item.vp,
      item.created
    ]),
    pg.query(insertUserQuery, [user.id, user.vote_count, user.proposal_count, user.created]),
    pg.query(updateSpaceQuery, [item.space]),
    pg.query(updateProposalQuery, [
      item.vp,
      scoreIncreases[1],
      scoreIncreases[2],
      scoreIncreases[3],
      `${item.space}/${item.proposal}`
    ]),
    pg.query(updateUserQuery, [item.voter])
  ]);
};
