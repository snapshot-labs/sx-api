import { GetBlockResponse, Provider } from 'starknet';
import { starknetKeccak } from 'starknet/utils/hash';
import { validateAndParseAddress } from 'starknet/utils/address';
import Promise from 'bluebird';
import getGraphQL from './graphql';
import { GqlEntityController } from './graphql/controller';
import { createLogger, Logger, LogLevel } from './utils/logger';
import { AsyncMySqlPool, createMySqlPool } from './mysql';
import { CheckpointConfig, CheckpointOptions } from './types';
import { getContractFromCheckpointConfig } from './utils/checkpoint';

export default class Checkpoint {
  public config;
  public writer;
  public schema: string;
  public provider: Provider;

  private readonly entityController: GqlEntityController;
  private readonly log: Logger;
  private readonly sourceContracts: string[];

  private mysqlPool?: AsyncMySqlPool;
  private mysqlConnection?: string;

  constructor(config: CheckpointConfig, writer, schema: string, opts?: CheckpointOptions) {
    this.config = config;
    this.writer = writer;
    this.schema = schema;
    this.entityController = new GqlEntityController(schema);
    this.provider = new Provider({ network: this.config.network });
    this.sourceContracts = getContractFromCheckpointConfig(config);

    this.log = createLogger({
      base: { component: 'checkpoint' },
      level: opts?.logLevel || LogLevel.Error,
      ...(opts?.prettifyLogs
        ? {
            transport: {
              target: 'pino-pretty'
            }
          }
        : {})
    });

    this.mysqlConnection = opts?.dbConnection;
  }

  /**
   * Returns an express handler that exposes a GraphQL API to query entities defined
   * in the schema.
   *
   */
  public get graphql() {
    return getGraphQL(this.entityController.createEntityQuerySchema(), {
      log: this.log.child({ component: 'resolver' }),
      mysql: this.mysql
    });
  }

  public async start() {
    this.log.debug('starting');
    const blockNum = await this.getStartBlockNum();
    return await this.next(blockNum);
  }

  public async reset() {
    this.log.debug('reset');
    await this.entityController.createEntityStores(this.mysql);
  }

  private async getStartBlockNum() {
    let start = 0;
    const lastBlock = await this.mysql.queryAsync('SELECT * FROM checkpoint LIMIT 1');
    const nextBlock = lastBlock[0].number + 1;
    this.config.sources.forEach(source => {
      start = start === 0 || start > source.start ? source.start : start;
    });
    return nextBlock > start ? nextBlock : start;
  }

  private async getNextBlockNumber(blockNumber: number) {}

  private async next(blockNum: number) {
    //this.mysql.queryAsync(
    //'SELECT * FROM _checkpoints WHERE block_number = ? AND contract_address IN ?',
    //[blockNum, [this.sourceContracts]]
    //);
    this.log.debug({ blockNumber: blockNum }, 'next block');

    let block: GetBlockResponse;
    try {
      block = await this.provider.getBlock(blockNum);
    } catch (e) {
      this.log.error({ blockNumber: blockNum, err: e }, 'getting block failed... retrying');

      await Promise.delay(12e3);
      return this.next(blockNum);
    }

    await this.handleBlock(block);
    const query = 'UPDATE checkpoint SET number = ?';
    await this.mysql.queryAsync(query, [block.block_number]);
    return this.next(blockNum + 1);
  }

  private async handleBlock(block: GetBlockResponse) {
    this.log.info({ blockNumber: block.block_number }, 'handling block');

    for (const receipt of Object.values(block.transaction_receipts)) {
      await this.handleTx(block, block.transactions[receipt.transaction_index], receipt);
    }

    this.log.debug({ blockNumber: block.block_number }, 'handling block done');
  }

  private async handleTx(block, tx, receipt) {
    this.log.debug({ txIndex: tx.transaction_index }, 'handling transaction');

    for (const source of this.config.sources) {
      const contract = validateAndParseAddress(source.contract);

      if (contract === validateAndParseAddress(tx.contract_address)) {
        if (tx.type === 'DEPLOY' && source.deploy_fn) {
          this.log.info(
            { contract: source.contract, txType: tx.type, handlerFn: source.deploy_fn },
            'found deployment transaction'
          );

          await this.writer[source.deploy_fn]({ source, block, tx, receipt, mysql: this.mysql });
        }
      }

      for (const event of receipt.events) {
        if (contract === validateAndParseAddress(event.from_address)) {
          for (const sourceEvent of source.events) {
            if (`0x${starknetKeccak(sourceEvent.name).toString('hex')}` === event.keys[0]) {
              this.log.info(
                { contract: source.contract, event: sourceEvent.name, handlerFn: sourceEvent.fn },
                'found contract event'
              );

              await this.writer[sourceEvent.fn]({ source, block, tx, receipt, mysql: this.mysql });
            }
          }
        }
      }
    }

    this.log.debug({ txIndex: tx.transaction_index }, 'handling transaction done');
  }

  private get mysql(): AsyncMySqlPool {
    if (this.mysqlPool) {
      return this.mysqlPool;
    }

    // lazy initialization of mysql connection
    return (this.mysqlPool = createMySqlPool(this.mysqlConnection));
  }
}
