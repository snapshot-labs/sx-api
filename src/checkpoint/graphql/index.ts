import { graphqlHTTP } from 'express-graphql';
import { makeExecutableSchema } from '@graphql-tools/schema';
import { toGql, toQueryResolver } from './utils';

export default function get(types: string) {
  const rootValue = { Query: toQueryResolver(types) };
  const typeDefs = toGql(types);
  const schema = makeExecutableSchema({ typeDefs, resolvers: rootValue });
  return graphqlHTTP({ schema, rootValue, graphiql: {} });
}
