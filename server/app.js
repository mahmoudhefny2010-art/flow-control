// Express application factory shared by the local server and Vercel.
require('dotenv').config({ override: false });
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');
const config = require('./config');
const { createStore } = require('./lib/storage');
const { createLegacyApi } = require('./lib/legacyApi');
const { LegacyClient } = require('./lib/legacyClient');
const { attachSocket } = require('./lib/socket');

function createApplication(express) {
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
  });
  const storePromise = createStore();

  app.use(require('helmet')({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(require('cors')());
  app.use(express.json({ limit: '256kb' }));

  const legacyApi = createLegacyApi();
  app.use('/api/legacy', legacyApi.router);
  app.set('io', io);
  app.set('legacyClient', new LegacyClient(config.legacyApiBase, config.port));
  app.set('legacyState', legacyApi.state);

  // Wait for persistent storage before any API route accesses app state.
  app.use(async (req, res, next) => {
    try {
      app.set('store', await storePromise);
      next();
    } catch (error) {
      next(error);
    }
  });

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
  app.use('/api/registrar', require('./routes/registrar'));
  app.use('/api/admin', require('./routes/admin'));
  app.use('/api/analytics', require('./routes/analytics'));
  app.use('/api/campus', require('./routes/campus'));
  app.use('/api/integration', require('./routes/integration'));
  app.use('/api/notifications', require('./routes/notifications'));

  attachSocket(io, () => storePromise);

  const pageShells = new Set([
    'account', 'admin', 'analytics', 'auth', 'booking', 'employee', 'feedback',
    'home', 'my-queue', 'outside', 'portal', 'portal-booking', 'register',
    'registrar', 'room',
  ]);
  app.get(['/pages/:page', '/pages/:page/index.html'], (req, res, next) => {
    if (!pageShells.has(req.params.page)) return next();
    res.redirect(301, `/pages/${req.params.page}.html`);
  });

  app.use(express.static(path.join(__dirname, '..', 'public')));
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
  });

  app.use((err, req, res, next) => {
    const status = err.status || 500;
    console.error('[api]', err.status ? `${status} ${err.message}` : err);
    res.status(status).json({ error: err.message || 'Internal server error' });
  });

  return { app, server, io, storePromise };
}

module.exports = { createApplication };
