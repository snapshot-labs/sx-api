import 'dotenv/config';
import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import Checkpoint, { LogLevel } from './checkpoint';
import config from './config.json';
import * as writer from './writer';
import checkpoints from './checkpoints.json';

const dir = __dirname.endsWith('dist/src') ? '../' : '';
const schemaFile = path.join(__dirname, `${dir}../src/schema.gql`);
const schema = fs.readFileSync(schemaFile, 'utf8');

const checkpoint = new Checkpoint(config, writer, schema, {
  logLevel: LogLevel.Info,
  prettifyLogs: process.env.NODE_ENV !== 'production'
});
checkpoint.reset();

checkpoint.seedCheckpoint(checkpoints).then(() => checkpoint.start());

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json({ limit: '4mb' }));
app.use(bodyParser.urlencoded({ limit: '4mb', extended: false }));
app.use(cors({ maxAge: 86400 }));

// quick scan expoint for checkpoint blocks
app.get('/_checkpoints', async (req, res) => {
  let fromBlock = 0;
  if (req.query.from && typeof req.query.from === 'string') {
    fromBlock = parseInt(req.query.from, 10) || 0;
  }

  let limit = 20;
  if (req.query.limit && typeof req.query.limit === 'string') {
    const queryLimit = parseInt(req.query.limit, 10) || 20;
    // ensures we limit maximum block possible blocks returned to 100 for now
    limit = Math.min(queryLimit, 100);
  }

  const blocks = await checkpoint.exportCheckpoints(fromBlock, limit);
  console.log('Blocks', blocks, fromBlock, limit);

  res.json(blocks);
});

app.use('/', checkpoint.graphql);

app.listen(PORT, () => console.log(`Listening at http://localhost:${PORT}`));
