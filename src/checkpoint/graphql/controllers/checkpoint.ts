import {
  GraphQLFieldConfig,
  GraphQLFieldConfigMap,
  GraphQLInt,
  GraphQLList,
  GraphQLNonNull,
  GraphQLString
} from 'graphql';
import {
  queryCheckpoints,
  queryLastIndexedBlock,
  queryLatestStarknetBlock,
  ResolverContext
} from '../resolvers';

/**
 * Controller for generating query and mutation schemas relating
 * to core checkpoints data.
 *
 */
export class GqlCheckpointController {
  /**
   * This generate graphql Query fields required to introspect
   * how Checkpoint is performing.
   *
   * Fields exposed are prefixed with an underscore, so they are
   * distinguishable from the Entity Queries.
   *
   */
  public generateQueryFields(): GraphQLFieldConfigMap<any, ResolverContext> {
    return {
      _last_indexed_block: this.lastIndexedBlockField(),
      _latest_starknet_block: this.latestStarknetBlockField(),
      _checkpoints: this.checkpointsField()
    };
  }

  private lastIndexedBlockField(): GraphQLFieldConfig<any, ResolverContext> {
    return {
      type: GraphQLInt,
      description: 'Fetch the last block Checkpoint has processed.',
      resolve: queryLastIndexedBlock
    };
  }

  private latestStarknetBlockField(): GraphQLFieldConfig<any, ResolverContext> {
    return {
      type: GraphQLInt,
      description: `Fetch the latest block number on Starknet.
        Useful for comparing how far behind this Checkpoint's _last_indexed_block is behind the latest block. 
      NOTE: Querying this field can be quite slow.`,
      resolve: queryLatestStarknetBlock
    };
  }

  private checkpointsField(): GraphQLFieldConfig<any, ResolverContext> {
    return {
      type: new GraphQLList(GraphQLInt),
      description: 'Fetch starknet blocks (checkpoints) where a contracts interaction exists.',
      args: {
        contract: {
          type: new GraphQLNonNull(GraphQLString),
          description: 'contract address to fetch checkpoint blocks'
        },
        fromBlock: {
          type: GraphQLInt,
          description: 'filter result starting from this block'
        },
        size: {
          type: GraphQLInt,
          description:
            'maximum size of blocks to return in results. defaults to 100. Max possible value is 1000.'
        }
      },
      resolve: queryCheckpoints
    };
  }
}
