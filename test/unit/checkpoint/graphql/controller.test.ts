import { GraphQLObjectType, GraphQLSchema, printSchema } from 'graphql';
import { mock } from 'jest-mock-extended';
import { GqlCheckpointController } from '../../../../src/checkpoint/graphql/controllers/checkpoint';
import { GqlEntityController } from '../../../../src/checkpoint/graphql/controllers/entity';
import { AsyncMySqlPool } from '../../../../src/checkpoint/mysql';

describe('GqlEntityController', () => {
  describe('generateQueryFields', () => {
    it('should work', () => {
      const controller = new GqlEntityController(`
type Vote {
  id: Int!
  name: String
}
  `);
      const queryFields = controller.generateQueryFields();
      const querySchema = new GraphQLObjectType({
        name: 'Query',
        fields: queryFields
      });

      const schema = printSchema(new GraphQLSchema({ query: querySchema }));
      expect(schema).toMatchSnapshot();
    });

    // list of error table tests
    describe.each([
      {
        reason: 'non null object id',
        schema: `type Vote { id: String }`
      },
      {
        reason: 'object id is not scalar type',
        schema: `type Vote { id: Participant! }\n\n type Participant { id: Int! }`
      },
      {
        reason: 'object id is not scalar type 2',
        schema: `type Participant { id: [Int]! }`
      }
    ])('should fail for $reason', ({ schema }) => {
      const controller = new GqlEntityController(schema);
      expect(() => controller.generateQueryFields()).toThrowErrorMatchingSnapshot();
    });
  });

  describe('createEntityStores', () => {
    it('should work', async () => {
      const mockMysql = mock<AsyncMySqlPool>();
      const controller = new GqlEntityController(`
type Vote {
  id: Int!
  name: String
}
  `);
      await controller.createEntityStores(mockMysql);

      expect(mockMysql.queryAsync).toMatchSnapshot();
    });
  });
});

describe('GqlCheckpointController', () => {
  describe('generateQueryFields', () => {
    it('should work', () => {
      const controller = new GqlCheckpointController();
      const queryFields = controller.generateQueryFields();
      const querySchema = new GraphQLObjectType({
        name: 'Query',
        fields: queryFields
      });
      const schema = printSchema(new GraphQLSchema({ query: querySchema }));

      expect(schema).toMatchSnapshot();
    });

    it('should prefix all fields with underscore', () => {
      const controller = new GqlCheckpointController();
      const queryFields = controller.generateQueryFields();

      Object.keys(queryFields).forEach(fieldName => {
        expect(fieldName.substring(0, 1)).toEqual('_');
      });
    });
  });
});
