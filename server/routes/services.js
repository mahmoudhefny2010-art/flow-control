// Services & booking routes
const express = require('express');
const { validate, badRequest } = require('../lib/validate');
const { allowRoles } = require('../lib/auth');
const engine = require('../lib/queueEngine');
const { id } = require('../lib/util');
const QRCode = require('qrcode');

const router = express.Router();

// GET /api/services - public catalog with live stats
router.get('/', async (req, res) => {
  const store = req.app.get('store');
  const io = req.app.get('io');
  const services = await store.find('services', { active: true }, { sort: { name: 1 } });
  const result = [];
  for (const s of services) {
    const waiting = await store.count('tickets', { serviceId: s._id, status: 'waiting' });
    const called = await store.count('tickets', { serviceId: s._id, status: 'called' });
    const openCounters = await store.count('counters', { serviceId: s._id, status: 'open' });
    // avg wait of today's served
    const served = await store.find('tickets', {
      serviceId: s._id,
      status: 'served',
      createdAt: { $gte: new Date(new Date().setHours(0, 0, 0, 0)).toISOString() },
    });
    const waits = served.filter((t) => t.waitMinutes != null).map((t) => t.waitMinutes);
    const avgWait = waits.length ? Math.round(waits.reduce((a, b) => a + b, 0) / waits.length) : 0;
    result.push({ ...s, waiting, called, openCounters, avgWaitMinutesToday: avgWait });
  }
  res.json({ services: result });
});

// GET /api/services/:id - single service detail
router.get('/:id', async (req, res) => {
  const store = req.app.get('store');
  const service = await store.findOne('services', { _id: req.params.id, active: true });
  if (!service) return res.status(404).json({ error: 'Service not found' });
  const counters = await store.find('counters', { serviceId: service._id });
  res.json({ service, counters });
});

// POST /api/services/:id/book - join the virtual queue
router.post('/:id/book', allowRoles('student', 'employee', 'admin'), async (req, res, next) => {
  const { valid, errors } = validate(req.body || {}, {
    priority: { type: 'enum', enum: ['normal', 'high'] },
    note: { type: 'string', max: 300 },
  });
  if (!valid) return badRequest(res, errors);
  try {
    const io = req.app.get('io');
    const store = req.app.get('store');
    const ticket = await engine.joinQueue(io, store, {
      serviceId: req.params.id,
      userId: req.user.sub,
      priority: req.body.priority || 'normal',
      note: req.body.note || '',
    });
    res.status(201).json({ ticket });
  } catch (err) {
    next(err);
  }
});

// POST /api/services/legacy-book - book through the LEGACY system API
// Demonstrates API-level integration: ticket created in legacy, then synced.
router.post('/legacy-book', allowRoles('student', 'employee', 'admin'), async (req, res, next) => {
  const { valid, errors } = validate(req.body || {}, {
    legacyQueueId: { type: 'string', required: true },
    priority: { type: 'enum', enum: ['normal', 'high'] },
  });
  if (!valid) return badRequest(res, errors);
  try {
    const store = req.app.get('store');
    const io = req.app.get('io');
    const legacy = req.app.get('legacyClient');
    const legacyTicket = await legacy.createTicket(req.body.legacyQueueId, {
      studentId: req.user.email,
      priority: req.body.priority || 'normal',
    });
    // Sync it into our platform
    await engine.syncFromLegacy(io, store, legacy);
    const ticket = await store.findOne('tickets', { externalId: legacyTicket.id });
    res.status(201).json({ ticket, legacy: legacyTicket });
  } catch (err) {
    next(err);
  }
});

// GET /api/services/:id/qr/:ticketId - QR code PNG for a ticket
router.get('/:id/qr/:ticketId', async (req, res) => {
  const store = req.app.get('store');
  const ticket = await store.findOne('tickets', { _id: req.params.ticketId });
  if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
  const base = `${req.protocol}://${req.get('host')}`;
  const payload = JSON.stringify({
    ticketId: ticket._id,
    code: ticket.code,
    service: ticket.serviceName,
    status: ticket.status,
    position: ticket.position,
    verify: `${base}/api/tickets/${ticket._id}/public`,
  });
  try {
    const png = await QRCode.toBuffer(payload, { width: 320, margin: 1 });
    res.setHeader('Content-Type', 'image/png');
    res.send(png);
  } catch (err) {
    res.status(500).json({ error: 'QR generation failed' });
  }
});

module.exports = router;
