import mysql from '../mysql';

export async function queryMulti(parent, args, context, info) {
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

export async function querySingle(parent, args, context, info) {
  const query = `SELECT * FROM ${info.fieldName}s WHERE id = ? LIMIT 1`;
  const [item] = await mysql.queryAsync(query, [args.id]);
  return item;
}
