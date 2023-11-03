import 'dotenv/config';
import path from 'path';
import fs from 'fs';
import Checkpoint, { createGetLoader, LogLevel } from '@snapshot-labs/checkpoint';
import { ApolloServer } from '@apollo/server';
import { startStandaloneServer } from '@apollo/server/standalone';
import config from './config.json';
import spaceFactoryAbi from './abis/spaceFactory.json';
import spaceAbi from './abis/space.json';
import * as writer from './writer';

const dir = __dirname.endsWith('dist/src') ? '../' : '';
const schemaFile = path.join(__dirname, `${dir}../src/schema.gql`);
const schema = fs.readFileSync(schemaFile, 'utf8');

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;

if (process.env.NETWORK_NODE_URL) {
  config.network_node_url = process.env.NETWORK_NODE_URL;
}

if (process.env.CA_CERT) {
  process.env.CA_CERT = process.env.CA_CERT.replace(/\\n/g, '\n');
}

const checkpoint = new Checkpoint(config, writer, schema, {
  logLevel: LogLevel.Error,
  resetOnConfigChange: true,
  prettifyLogs: process.env.NODE_ENV !== 'production',
  abis: {
    SpaceFactory: spaceFactoryAbi,
    Space: spaceAbi
  }
});

async function run() {
  await checkpoint.reset();

  checkpoint.start();

  const server = new ApolloServer({
    schema: checkpoint.getSchema()
  });

  const { url } = await startStandaloneServer(server, {
    listen: { port: PORT },
    context: async () => {
      const baseContext = checkpoint.getBaseContext();
      return {
        ...baseContext,
        getLoader: createGetLoader(baseContext)
      };
    }
  });

  console.log(`Listening at ${url}`);
}

run();
