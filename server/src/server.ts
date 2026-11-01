import http from 'http';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { connectDb } from './config/db.js';
import { createApp } from './app.js';
import { initSockets } from './sockets/index.js';

async function main() {
  await connectDb();
  const server = http.createServer(createApp());
  initSockets(server);
  server.listen(env.PORT, () => logger.info(`FlowSync API listening on :${env.PORT}`));
  const shutdown = () => server.close(() => process.exit(0));
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  logger.error({ err }, 'Failed to start server');
  process.exit(1);
});
