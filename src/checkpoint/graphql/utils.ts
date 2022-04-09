import {
  introspectionFromSchema,
  IntrospectionNamedTypeRef,
  IntrospectionObjectType
} from 'graphql';
import { makeExecutableSchema } from '@graphql-tools/schema';
import { IResolvers } from '@graphql-tools/utils';
import mysql from '../mysql';

async function queryMulti(parent, args, context, info) {
  const params: any = [];
  let whereSql = '';
  if (args.where) {
    Object.entries(args.where).map(w => {
      whereSql += !whereSql ? `WHERE ${w[0]} = ? ` : ` AND ${w[0]} = ?`;
      params.push(w[1]);
    });
  }
  const first = args?.first || 1000;
  const skip = args?.skip || 0;
  const orderBy = 'created';
  const orderDirection = 'DESC';
  params.push(skip, first);
  return await mysql.queryAsync(
    `SELECT * FROM ${info.fieldName} ${whereSql} ORDER BY ${orderBy} ${orderDirection} LIMIT ?, ?`,
    params
  );
}

async function querySingle(parent, args, context, info) {
  const query = `SELECT * FROM ${info.fieldName}s WHERE id = ? LIMIT 1`;
  const [item] = await mysql.queryAsync(query, [args.id]);
  return item;
}

/**
 * Returns a list of objects defined within the graphql typedefs.
 * The types returns are introspection objects, that can be used
 * for inspecting the fields and types.
 *
 * Note, that the returned objects does not include the Query object type if defined.
 *
 */
const getObjectsSchemas = (typeDefs: string): IntrospectionObjectType[] => {
  const schema = makeExecutableSchema({ typeDefs: `type Query { x: String }\n${typeDefs}` });
  return introspectionFromSchema(schema)
    .__schema.types.filter(type => {
      return (
        type.kind === 'OBJECT' &&
        type.fields &&
        !type.name.startsWith('__') &&
        type.name !== 'Query'
      );
    })
    .map(type => type as IntrospectionObjectType);
};

/**
 * toSql generates SQL statements to create tables based on the types defined
 * in the GraphQL typeDefs.
 *
 * The generated SQL statment also creates a `checkpoint` table to track block
 * checkpoints.
 *
 * For example, given an input like:
 * ```graphql
 * type Vote {
 *  id: Int!
 *  name: String
 * }
 * ```
 *
 * will return the following SQL:
 * ```sql
 * DROP TABLE IF EXISTS checkpoint;
 * CREATE TABLE checkpoint (number BIGINT NOT NULL, PRIMARY KEY (number));
 * INSERT checkpoint SET number = 0;·
 * DROP TABLE IF EXISTS votes;
 * CREATE TABLE votes (
 *   id VARCHAR(128) NOT NULL,
 *   name VARCHAR(128) NOT NULL,
 *   PRIMARY KEY (id) ,
 *   INDEX id (id),
 *   INDEX name (name)
 * );
 * ```
 *
 */
export function toSql(typeDefs: string): string {
  let sql = 'DROP TABLE IF EXISTS checkpoint;';
  sql += '\nCREATE TABLE checkpoint (number BIGINT NOT NULL, PRIMARY KEY (number));';
  sql += '\nINSERT checkpoint SET number = 0;';

  getObjectsSchemas(typeDefs).forEach(type => {
    sql += `\n\nDROP TABLE IF EXISTS ${type.name.toLowerCase()}s;`;
    sql += `\nCREATE TABLE ${type.name.toLowerCase()}s (`;
    let sqlIndexes = ``;
    type.fields.forEach(field => {
      const fieldType = (field.type as IntrospectionNamedTypeRef).name;
      let sqlType = 'VARCHAR(128)';
      if (fieldType === 'Int') sqlType = 'INT(128)';
      if (fieldType === 'String') sqlType = 'VARCHAR(128)';
      if (fieldType === 'Text') sqlType = 'TEXT';
      sql += `\n  ${field.name} ${sqlType} NOT NULL,`;
      if (fieldType !== 'Text') sqlIndexes += `,\n  INDEX ${field.name} (${field.name})`;
    });
    sql += `\n  PRIMARY KEY (id) ${sqlIndexes}\n);`;
  });
  return sql;
}

const generateGqlQueries = (types: IntrospectionObjectType[]): string => {
  let gql = 'type Query {';
  types.forEach(type => {
    gql += `\n  ${type.name.toLowerCase()}s(`;
    gql += `\n    first: Int`;
    gql += `\n    skip: Int`;
    gql += `\n    orderBy: String`;
    gql += `\n    orderDirection: String`;
    gql += `\n    where: Where${type.name}`;
    gql += `\n  ): [${type.name}]`;
    gql += `\n  ${type.name.toLowerCase()}(id: String): ${type.name}`;
  });
  gql += `\n}`;
  return gql;
};

const generateGqlQueryInputs = (types: IntrospectionObjectType[]): string => {
  let where = '';
  types.forEach(type => {
    where += `\n\ninput Where${type.name} {`;
    type.fields.forEach(field => {
      const fieldType = (field.type as IntrospectionNamedTypeRef).name;
      if (fieldType !== 'Text') {
        where += `\n  ${field.name}: ${fieldType}`;
        where += `\n  ${field.name}_in: [${fieldType}]`;
        if (fieldType === 'Int') {
          where += `\n  ${field.name}_gt: ${fieldType}`;
          where += `\n  ${field.name}_gte: ${fieldType}`;
          where += `\n  ${field.name}_lt: ${fieldType}`;
          where += `\n  ${field.name}_lte: ${fieldType}`;
        }
      }
    });
    where += `\n}`;
  });
  return where;
};

/**
 * toGql returns a graphql schema string with generated queries for fetching
 * the already defined types in the input schema. For each type, a single and
 * multi (pluralized name) query is generated.
 *
 * For example, given the input schema:
 * ```
 * type Vote {
 *  id: Int!
 *  name: String
 * }
 * ```
 *
 * The generated queries will be like:
 * ```
 * type Query {
 *  votes(
 *     first: Int
 *     skip: Int
 *     orderBy: String
 *     orderDirection: String
 *     where: WhereVote
 *   ): [Vote]
 *   vote(id: String): Vote
 * }
 *
 *  input WhereVote {
 *    id: null
 *    id_in: [null]
 *    name: String
 *    name_in: [String]
 *  }
 *
 * ```
 *
 */
export function toGql(typeDefs: string): string {
  const objectTypes = getObjectsSchemas(typeDefs);
  const gqlQuery = generateGqlQueries(objectTypes);
  const gqlQueryInputs = generateGqlQueryInputs(objectTypes);

  return `${gqlQuery}\n${gqlQueryInputs}\n\n${typeDefs}`;
}

/**
 * toQuery creates an object of resolvers  based on types defined within graphql
 * schema.
 *
 * For example, given the input:
 * ```graphql
 * type Vote {
 *  id: Int!
 *  name: String
 * }
 * ```
 *
 * will return an object of the form:
 * ```
 * Object {
 *  vote: GQLResolver,
 *  votes: GQLResolver,
 * }
 * ```
 *
 * Note that a plural resolver is also created for each field
 */
export function toQueryResolver(typeDefs: string): IResolvers {
  const query = {};
  getObjectsSchemas(typeDefs).forEach(type => {
    query[`${type.name.toLowerCase()}s`] = queryMulti;
    query[type.name.toLowerCase()] = querySingle;
  });
  return query;
}
