import { AsyncMySqlPool } from '../mysql';
import { Logger } from '../utils/logger';

const Table = {
  Checkpoints: '_checkpoints',
  Metadata: '_metadata'
};

const Fields = {
  Checkpoints: {
    BlockNumber: 'block_number',
    ContractAddress: 'contract_address'
  },
  Metadata: {
    Id: 'id',
    Value: 'value'
  }
};

type ToString = {
  toString: () => string;
};

export interface CheckpointRecord {
  blockNumber: number;
  contractAddress: string;
}

/**
 * Checkpoints store is a data store class for managing
 * checkpoints data schema and records.
 *
 * It interacts with an underlying mysql database.
 */
export class CheckpointsStore {
  constructor(private readonly mysql: AsyncMySqlPool, private readonly log: Logger) {}

  public async createStore(): Promise<void> {
    this.log.debug('creating checkpoints tables...');

    let sql = `CREATE TABLE IF NOT EXISTS ${Table.Checkpoints} (
      ${Fields.Checkpoints.BlockNumber} BIGINT NOT NULL,
      ${Fields.Checkpoints.ContractAddress} VARCHAR(65) NOT NULL,
      PRIMARY KEY (${Fields.Checkpoints.BlockNumber}, ${Fields.Checkpoints.ContractAddress})
    );`;

    sql += `\nCREATE TABLE IF NOT EXISTS ${Table.Metadata} (
      ${Fields.Metadata.Id} VARCHAR(20) NOT NULL,
      ${Fields.Metadata.Value} VARCHAR(128) NOT NULL,
      PRIMARY KEY (${Fields.Metadata.Id})
    );`;

    await this.mysql.queryAsync(sql);
    this.log.debug('checkpoints tables created');
  }

  public async deleteStore(): Promise<void> {
    this.log.debug('deleting checkpoints tables...');

    let sql = `DROP TABLE IF EXISTS ${Table.Checkpoints};\n`;
    sql += `DROP TABLE IF EXISTS ${Table.Metadata};\n`;

    await this.mysql.queryAsync(sql.trimEnd());
    this.log.debug('checkpoints tables deleted');
  }

  public async getMetadata(id: string): Promise<string | undefined> {
    const value = await this.mysql.queryAsync(
      `SELECT ${Fields.Metadata.Value} FROM ${Table.Metadata} WHERE ${Fields.Metadata.Id} = ? LIMIT 1`,
      [id]
    );

    if (value.length == 0) {
      return undefined;
    }

    return value[0][Fields.Metadata.Value];
  }

  public async getMetadataNumber(id: string, base: number = 10): Promise<number | undefined> {
    const strValue = await this.getMetadata(id);
    if (!strValue) {
      return undefined;
    }

    return parseInt(strValue, base);
  }

  public async setMetadata(id: string, value: ToString): Promise<void> {
    await this.mysql.queryAsync(`REPLACE INTO ${Table.Metadata} VALUES (?,?)`, [
      id,
      value.toString()
    ]);
  }

  public async insertCheckpoints(checkpoints: CheckpointRecord[]): Promise<void> {
    if (checkpoints.length === 0) {
      return;
    }
    await this.mysql.queryAsync(`INSERT IGNORE INTO ${Table.Checkpoints} VALUES ?`, [
      checkpoints.map(checkpoint => {
        return [checkpoint.blockNumber, checkpoint.contractAddress];
      })
    ]);
  }
}
