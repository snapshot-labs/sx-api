import { GraphQLField, GraphQLFieldConfig, GraphQLFieldConfigMap, GraphQLInt } from 'graphql';
import { queryLastIndexedBlock, ResolverContext } from '../resolvers';

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
      _last_indexed_block: this.lastIndexedBlockField()
    };
  }

  private lastIndexedBlockField(): GraphQLFieldConfig<any, ResolverContext> {
    return {
      type: GraphQLInt,
      description: 'Fetch the last block Checkpoint has processed.',
      resolve: queryLastIndexedBlock
    };
  }
}
