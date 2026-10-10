// MIU QueueFlow - Smart Queue Management Platform
// Entry point: Express API + Socket.io + static SPA + mock legacy API
require('dotenv').config({ override: false });
const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const http = require('http');
const { Server } = require('socket.io');

const config = require('./config');
const { createStore } = require('./lib/storage');
const { createLegacyApi } = require('./lib/legacyApi');
const { LegacyClient } = require('./lib/legacyClient');
const { attachSocket } = require('./lib/socket');

async function bootstrap() {
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
  });

  // --- Storage ----------------------------------------------------------
  const store = await createStore();

  // --- Security middleware ----------------------------------------------
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cors());
  app.use(express.json({ limit: '256kb' }));

  // --- Legacy mock system (the "existing" queue platform) ---------------
  const legacyApi = createLegacyApi();
  app.use('/api/legacy', legacyApi.router);

  // --- App state ---------------------------------------------------------
  app.set('store', store);
  app.set('io', io);
  app.set('legacyClient', new LegacyClient(config.legacyApiBase, config.port));
  app.set('legacyState', legacyApi.state);

  // --- API routes ---------------------------------------------------------
  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      system: 'MIU QueueFlow',
      version: '1.0.0',
      time: new Date().toISOString(),
      storage: config.mongoUri ? 'mongodb' : 'json-dev',
    });
  });
  app.use('/api/auth', require('./routes/auth'));
  app.use('/api/services', require('./routes/services'));
  app.use('/api/tickets', require('./routes/tickets'));
  app.use('/api/employee', require('./routes/employee'));
  app.use('/api/admin', require('./routes/admin'));
  app.use('/api/analytics', require('./routes/analytics'));
  app.use('/api/campus', require('./routes/campus'));
  app.use('/api/integration', require('./routes/integration'));
  app.use('/api/notifications', require('./routes/notifications'));

  // --- Socket.io -----------------------------------------------------------
  attachSocket(io, async () => store);

  // --- Static SPA -----------------------------------------------------------
  app.use(express.static(path.join(__dirname, '..', 'public')));
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
  });

  // --- Error handler ---------------------------------------------------------
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || 500;
    console.error('[api]', err.status ? `${status} ${err.message}` : err);
    res.status(status).json({ error: err.message || 'Internal server error' });
  });

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

  // Graceful shutdown: flush the dev store to disk
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

bootstrap().catch((err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[server] Port ${config.port} is already in use. Stop the other server or set PORT to a free port in .env, then restart.`);
  } else {
    console.error('Fatal startup error:', err);
  }
  process.exit(1);
});
