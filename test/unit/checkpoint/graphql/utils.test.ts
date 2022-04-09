import { toQueryResolver, toSql, toGql } from '../../../../src/checkpoint/graphql/utils';

describe('toSql', () => {
  it('should work', () => {
    const typedef = `
type Vote {
  id: Int!
  name: String
}
    `;
    const sqlStatement = toSql(typedef);
    expect(sqlStatement).toMatchSnapshot();
  });
});

describe('toQueryResolver', () => {
  it('should work', () => {
    const typedef = `
type Vote {
  id: Int!
  name: String
}
    `;
    const query = toQueryResolver(typedef);
    expect(query).toMatchSnapshot();
  });
});

describe('toGql', () => {
  it('should work', () => {
    const typedef = `
type Vote {
  id: Int!
  name: String
}
    `;
    const query = toGql(typedef);
    expect(query).toMatchSnapshot();
  });
});
