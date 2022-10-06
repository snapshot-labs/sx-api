import 'reflect-metadata';
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import Checkpoint, { LogLevel } from '@snapshot-labs/checkpoint';
import { buildSchema } from 'type-graphql';
import { resolvers } from '@generated/type-graphql';
import { graphqlHTTP } from 'express-graphql';
import { PrismaClient } from '@prisma/client';
import config from './config.json';
import * as writer from './writer';

async function run() {
  const prisma = new PrismaClient();

  // @ts-ignore
  const checkpoint = new Checkpoint(config, writer, prisma, {
    logLevel: LogLevel.Info,
    prettifyLogs: process.env.NODE_ENV !== 'production'
  });
  checkpoint.start();

  // Does not work if built inside of checkpoint at the moment
  const schema = await buildSchema({
    resolvers,
    validate: false
  });

  const graphql = graphqlHTTP({
    schema,
    context: {
      prisma
    },
    graphiql: true
  });

  const app = express();
  const PORT = process.env.PORT || 3000;

  app.use(express.json({ limit: '4mb' }));
  app.use(express.urlencoded({ limit: '4mb', extended: false }));
  app.use(cors({ maxAge: 86400 }));
  app.use('/', graphql);

  app.listen(PORT, () => console.log(`Listening at http://localhost:${PORT}`));
}

run();
