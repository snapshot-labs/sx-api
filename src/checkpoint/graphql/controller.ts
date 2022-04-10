import {
  buildSchema,
  GraphQLField,
  GraphQLFieldConfig,
  GraphQLFieldConfigMap,
  GraphQLFieldResolver,
  GraphQLInputObjectType,
  GraphQLInputObjectTypeConfig,
  GraphQLInt,
  GraphQLList,
  GraphQLNonNull,
  GraphQLObjectType,
  GraphQLOutputType,
  GraphQLScalarType,
  GraphQLSchema,
  GraphQLString,
  Source
} from 'graphql';

import { querySingle, queryMulti } from './resolvers';

/**
 * Type for single and multiple query resolvers
 */
interface EntityQueryResolvers<Context = unknown> {
  singleEntityResolver: GraphQLFieldResolver<unknown, Context>;
  multipleEntityResolver: GraphQLFieldResolver<unknown, Context>;
}

/**
 * Controller for performing actions based on the graphql schema provided to its
 * constructor. It exposes public functions to generate graphql or database
 * items based on the entities identified in the schema.
 *
 * Note: Entities refer to Object types with an `id` field defined within the
 * graphql schema.
 */
export class GqlEntityController {
  private readonly schema: GraphQLSchema;

  constructor(typeDefs: string | Source) {
    this.schema = buildSchema(typeDefs);
  }

  /**
   * Creates a grqphql Query object generated from the objects defined within
   * the schema.
   * For each of the objects, two queries are created, one for querying the object
   * by it's id and the second for querying multiple objects based on a couple
   * of parameters.
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
   *    id: Int
   *    id_in: [Int]
   *    name: String
   *    name_in: [String]
   *  }
   *
   * ```
   *
   */
  public createEntityQuerySchema(
    resolvers: EntityQueryResolvers = {
      singleEntityResolver: querySingle,
      multipleEntityResolver: queryMulti
    }
  ): GraphQLObjectType {
    const queryFields: GraphQLFieldConfigMap<any, any> = {};

    this.schemaObjects.forEach(type => {
      queryFields[type.name.toLowerCase()] = this.getSingleEntityQueryConfig(
        type,
        resolvers.singleEntityResolver
      );
      queryFields[`${type.name.toLowerCase()}s`] = this.getMultipleEntityQueryConfig(
        type,
        resolvers.multipleEntityResolver
      );
    });

    return new GraphQLObjectType({
      name: 'Query',
      fields: queryFields
    });
  }

  /**
   * Creates store for each of the objects in the schema.
   * For now, it only creates mysql tables for each of the objects.
   * It also creates a checkpoint table to track checkpoints visited.
   *
   * For example, given an schema like:
   * ```graphql
   * type Vote {
   *  id: Int!
   *  name: String
   * }
   * ```
   *
   * will execute the following SQL:
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
  public async createEntityStore(mysql): Promise<void> {
    let sql = 'DROP TABLE IF EXISTS checkpoint;';
    sql += '\nCREATE TABLE checkpoint (number BIGINT NOT NULL, PRIMARY KEY (number));';
    sql += '\nINSERT checkpoint SET number = 0;';

    this.schemaObjects.forEach(type => {
      sql += `\n\nDROP TABLE IF EXISTS ${type.name.toLowerCase()}s;`;
      sql += `\nCREATE TABLE ${type.name.toLowerCase()}s (`;
      let sqlIndexes = ``;

      this.getTypeFields(type).forEach(field => {
        const fieldType = (field.type as GraphQLObjectType).name;
        let sqlType = 'VARCHAR(128)';
        if (fieldType === 'Int') sqlType = 'INT(128)';
        if (fieldType === 'String') sqlType = 'VARCHAR(128)';
        if (fieldType === 'Text') sqlType = 'TEXT';
        sql += `\n  ${field.name} ${sqlType} NOT NULL,`;
        if (fieldType !== 'Text') sqlIndexes += `,\n  INDEX ${field.name} (${field.name})`;
      });
      sql += `\n  PRIMARY KEY (id) ${sqlIndexes}\n);`;
    });

    return mysql.queryAsync(sql);
  }

  /**
   * Returns a list of objects defined within the graphql typedefs.
   * The types returns are introspection objects, that can be used
   * for inspecting the fields and types.
   *
   * Note: that the returned objects does not include the Query object type if defined.
   *
   */
  private get schemaObjects(): GraphQLObjectType[] {
    return Object.values(this.schema.getTypeMap()).filter(type => {
      return (
        type instanceof GraphQLObjectType && type.name != 'Query' && !type.name.startsWith('__')
      );
    }) as GraphQLObjectType[];
  }

  private getTypeFields<Parent, Context>(
    type: GraphQLObjectType<Parent, Context>
  ): GraphQLField<Parent, Context>[] {
    return Object.values(type.getFields());
  }

  private getSingleEntityQueryConfig<Parent, Context>(
    type: GraphQLObjectType,
    resolver: GraphQLFieldResolver<Parent, Context>
  ): GraphQLFieldConfig<Parent, Context> {
    return {
      type,
      args: {
        id: { type: this.getObjectId(type) }
      },
      resolve: resolver
    };
  }

  private getMultipleEntityQueryConfig<Parent, Context>(
    type: GraphQLObjectType,
    resolver: GraphQLFieldResolver<Parent, Context>
  ): GraphQLFieldConfig<Parent, Context> {
    const whereInputConfig: GraphQLInputObjectTypeConfig = {
      name: `Where${type.name}`,
      fields: {}
    };

    this.getTypeFields(type).forEach(field => {
      const fieldType = this.getFieldType(field.type).name;
      if (field.type === GraphQLInt) {
        whereInputConfig.fields[`${field.name}_gt`] = { type: GraphQLInt };
        whereInputConfig.fields[`${field.name}_gte`] = { type: GraphQLInt };
        whereInputConfig.fields[`${field.name}_lt`] = { type: GraphQLInt };
        whereInputConfig.fields[`${field.name}_lte`] = { type: GraphQLInt };
      }

      if (fieldType !== 'Text') {
        whereInputConfig.fields[`${field.name}`] = { type: field.type };
        whereInputConfig.fields[`${field.name}_in`] = { type: new GraphQLList(field.type) };
      }
    });

    return {
      type: new GraphQLList(type),
      args: {
        first: {
          type: GraphQLInt
        },
        skip: {
          type: GraphQLInt
        },
        orderBy: {
          type: GraphQLString
        },
        orderDirection: {
          type: GraphQLString
        },
        where: { type: new GraphQLInputObjectType(whereInputConfig) }
      },
      resolve: resolver
    };
  }

  private getObjectId(type: GraphQLObjectType): GraphQLScalarType {
    const idField = type.getFields().id;
    if (!idField) {
      throw new Error(
        `'id' field is missing in type '${type.name}'. All types are required to have an id field.`
      );
    }

    // verify only scalar types are used
    if (!(idField.type instanceof GraphQLScalarType)) {
      throw new Error(`'id' field for type ${type.name} is not a scalar type`);
    }

    return idField.type;
  }

  /**
   * Return the type as a string and if nullable or not.
   */
  private getFieldType(type: GraphQLOutputType): { name: string; nullable: boolean } {
    // TODO: handle list types
    if (type instanceof GraphQLNonNull) {
      return { nullable: false, name: (type.ofType as GraphQLObjectType).name };
    }

    return { nullable: true, name: (type as GraphQLObjectType).name };
  }
}
