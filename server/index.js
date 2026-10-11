// Local server entry point. Vercel imports the Express app from the root index.
require('dotenv').config({ override: false });
const config = require('./config');
const { createApplication } = require('./app');

async function bootstrap() {
  const { app, server, io, storePromise } = createApplication();
  const store = await storePromise;

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });

  console.log(`\n  MIU QueueFlow running at http://localhost:${config.port}`);
  console.log(`  Mode: ${config.nodeEnv} | Storage: ${config.mongoUri ? 'MongoDB' : 'JSON (dev)'}`);
  console.log(`  Legacy API: ${config.legacyApiBase || 'built-in mock at /api/legacy'}\n`);

  const shutdown = (signal) => {
    console.log(`\n[server] ${signal} received, shutting down…`);
    if (typeof store.flush === 'function') store.flush();
    if (store.close) store.close().catch(() => {});
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  return { app, server, io, store };
}

if (require.main === module) {
  bootstrap().catch((err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[server] Port ${config.port} is already in use. Stop the other server or set PORT to a free port in .env, then restart.`);
    } else {
      console.error('Fatal startup error:', err);
    }
    process.exit(1);
  });
}

module.exports = { bootstrap };
