import { graphqlHTTP } from 'express-graphql';
import {
  GraphQLID,
  GraphQLNonNull,
  GraphQLObjectType,
  GraphQLSchema,
  GraphQLString
} from 'graphql';
import { ResolverContext } from './resolvers';

/**
 * Creates an graphql http handler for the query passed a parameters.
 * Returned middleware can be used with express.
 */
export default function get(query: GraphQLObjectType, context: ResolverContext) {
  const schema = new GraphQLSchema({ query });
  return graphqlHTTP({ schema, context, graphiql: {} });
}

/**
 * This objects name and field maps to the values of the _metadata
 * database store
 *
 */
export const MetadataGraphQLObject = new GraphQLObjectType({
  name: '_Metadata',
  description: 'Core metadata values used internally by Checkpoint',
  fields: {
    id: { type: new GraphQLNonNull(GraphQLID), description: 'example: last_indexed_block' },
    value: { type: GraphQLString }
  }
});
