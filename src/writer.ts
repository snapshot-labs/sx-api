import { formatUnits } from '@ethersproject/units';
import { shortStringArrToStr } from '@snapshot-labs/sx/dist/utils/strings';
import { validateAndParseAddress } from 'starknet';
import { getJSON, toAddress, getSpaceName, parseTimestamps } from './utils';
import { Space, Proposal, Vote, User } from '../codegen/models';
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
  instance
}) => {
  if (!event) return;

  console.log('Handle space created');

  const space = new Space(validateAndParseAddress(event.space_address));
  space.name = getSpaceName(event.space_address);
  space.controller = validateAndParseAddress(event.controller);
  space.voting_delay = parseInt(event.voting_delay);
  space.min_voting_period = parseInt(event.min_voting_duration);
  space.max_voting_period = parseInt(event.max_voting_duration);
  space.proposal_threshold = parseInt(uint256toString(event.proposal_threshold));
  space.quorum = parseInt(uint256toString(event.quorum));
  space.strategies = event.voting_strategies;
  space.strategies_params = event.voting_strategy_params_flat;
  space.strategies_metadata = [];
  space.authenticators = event.authenticators;
  space.executors = event.execution_strategies;
  space.proposal_count = 0;
  space.vote_count = 0;
  space.created = block?.timestamp ?? Date.now();
  space.tx = tx.transaction_hash ?? null;

  try {
    const metadataUri = shortStringArrToStr(event.metadata_uri || []).replaceAll('\x00', '');
    const metadata: any = metadataUri ? await getJSON(metadataUri) : {};

    if (metadata.name) space.name = metadata.name;
    if (metadata.description) space.about = metadata.description;
    if (metadata.external_url) space.external_url = metadata.external_url;

    if (metadata.properties) {
      if (metadata.properties.github) space.github = metadata.properties.github;
      if (metadata.properties.twitter) space.twitter = metadata.properties.twitter;
      if (metadata.properties.discord) space.discord = metadata.properties.discord;
      if (metadata.properties.wallets && metadata.properties.wallets.length > 0) {
        space.wallet = metadata.properties.wallets[0];
      }
    }
  } catch (e) {
    console.log('failed to parse space metadata', e);
  }

  await space.save();

  instance.executeTemplate('Space', {
    contract: space.id,
    start: blockNumber
  });
};

export const handleMetadataUriUpdated: CheckpointWriter = async ({ rawEvent, event }) => {
  if (!event || !rawEvent) return;

  console.log('Handle space metadata uri updated');

  const spaceAddress = validateAndParseAddress(rawEvent.from_address);

  const space = await Space.loadEntity(spaceAddress);
  if (!space) return;

  try {
    const metadataUri = shortStringArrToStr(event.new_metadata_uri).replaceAll('\x00', '');
    const metadata: any = await getJSON(metadataUri);

    if (metadata.name) space.name = metadata.name;
    if (metadata.description) space.about = metadata.description;
    if (metadata.external_url) space.external_url = metadata.external_url;

    if (metadata.properties) {
      if (metadata.properties.github) space.github = metadata.properties.github;
      if (metadata.properties.twitter) space.twitter = metadata.properties.twitter;
      if (metadata.properties.discord) space.discord = metadata.properties.discord;
      if (metadata.properties.wallets && metadata.properties.wallets.length > 0) {
        space.wallet = metadata.properties.wallets[0];
      }
    }

    await space.save();
  } catch (e) {
    console.log('failed to update space metadata', e);
  }
};

export const handlePropose: CheckpointWriter = async ({ block, tx, rawEvent, event }) => {
  if (!rawEvent || !event) return;

  console.log('Handle propose');

  const spaceId = validateAndParseAddress(rawEvent.from_address);
  const space = await Space.loadEntity(spaceId);
  if (!space) return;

  const proposalId = parseInt(BigInt(event.proposal_id).toString());
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

  const proposal = new Proposal(`${spaceId}/${proposalId}`);
  proposal.proposal_id = proposalId;
  proposal.space = spaceId;
  proposal.author = author;
  proposal.execution_hash = event.proposal.execution_hash;
  proposal.metadata_uri = metadataUri;
  proposal.title = title;
  proposal.body = body;
  proposal.discussion = discussion;
  proposal.execution = execution;
  proposal.start = parseInt(BigInt(timestamps.start).toString());
  proposal.min_end = parseInt(BigInt(timestamps.minEnd).toString());
  proposal.max_end = parseInt(BigInt(timestamps.maxEnd).toString());
  proposal.snapshot = parseInt(BigInt(timestamps.snapshot).toString());

  proposal.scores_1 = 0;
  proposal.scores_2 = 0;
  proposal.scores_3 = 0;
  proposal.scores_total = 0;
  proposal.quorum = parseInt(uint256toString(event.proposal.quorum));
  proposal.strategies = space.strategies;
  proposal.strategies_params = space.strategies_params;
  proposal.created = created;
  proposal.tx = tx.transaction_hash ?? null;
  proposal.vote_count = 0;

  await proposal.save();

  space.proposal_count = space.proposal_count + 1;
  await space.save();

  let user = await User.loadEntity(author);
  if (!user) user = new User(author);

  user.proposal_count = user.proposal_count + 1;
  user.created = created;
  await user.save();
};

export const handleVote: CheckpointWriter = async ({ block, rawEvent, event }) => {
  if (!rawEvent || !event) return;

  console.log('Handle vote', event);

  const spaceId = validateAndParseAddress(rawEvent.from_address);
  const proposalid = parseInt(event.proposal_id);
  const voterId = toAddress(event.voter_address.value);
  const choice = parseInt(BigInt(event.vote.choice).toString());
  const vp = parseFloat(formatUnits(uint256toString(event.vote.voting_power), 18));

  const created = block?.timestamp ?? Date.now();

  const space = await Space.loadEntity(spaceId);
  if (space) {
    space.vote_count = space.vote_count + 1;
    await space.save();
  }

  const proposal = await Proposal.loadEntity(`${spaceId}/${proposalid}`);
  if (proposal) {
    proposal.vote_count = proposal.vote_count + 1;
    proposal.scores_total = proposal.scores_total + vp;
    proposal.scores_1 = proposal.scores_1 + (choice === 1 ? vp : 0);
    proposal.scores_2 = proposal.scores_2 + (choice === 2 ? vp : 0);
    proposal.scores_3 = proposal.scores_3 + (choice === 3 ? vp : 0);
    await proposal.save();
  }

  let user = await User.loadEntity(voterId);
  if (!user) user = new User(voterId);
  user.created = created;
  user.vote_count = user.vote_count + 1;
  await user.save();

  const vote = new Vote(`${spaceId}/${proposalid}/${voterId}`);
  vote.space = spaceId;
  vote.proposal = proposalid;
  vote.voter = voterId;
  vote.choice = choice;
  vote.vp = vp;
  vote.created = created;
  await vote.save();
};
