// Employee (service desk) routes
const express = require('express');
const { validate, badRequest } = require('../lib/validate');
const { allowRoles } = require('../lib/auth');
const engine = require('../lib/queueEngine');
const { round1 } = require('../lib/util');

const router = express.Router();

// GET /api/employee/queues - queues the employee serves
router.get('/queues', allowRoles('employee', 'admin'), async (req, res) => {
  const store = req.app.get('store');
  let services;
  if (req.user.role === 'admin') {
    services = await store.find('services', { active: true }, { sort: { name: 1 } });
  } else {
    // employees are assigned to counters
    const counters = await store.find('counters', { employeeId: req.user.sub });
    const ids = [...new Set(counters.map((c) => c.serviceId))];
    services = [];
    for (const sid of ids) {
      const s = await store.findOne('services', { _id: sid, active: true });
      if (s) services.push(s);
    }
    // If employee has no counters, show all (demo convenience)
    if (services.length === 0) {
      services = await store.find('services', { active: true }, { sort: { name: 1 } });
    }
  }
  const out = [];
  for (const s of services) {
    const waiting = await engine.waitingTickets(store, s._id);
    const called = await store.find('tickets', { serviceId: s._id, status: 'called' });
    const counters = await store.find('counters', { serviceId: s._id });
    const myCounters = counters.filter((c) => c.employeeId === req.user.sub || req.user.role === 'admin');
    out.push({ ...s, waiting, called, counters, myCounters });
  }
  res.json({ queues: out });
});

// GET /api/employee/stats - today stats for the employee
router.get('/stats', allowRoles('employee', 'admin'), async (req, res) => {
  const store = req.app.get('store');
  const dayStart = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
  const served = await store.find('tickets', {
    servedBy: req.user.sub,
    status: 'served',
    servedAt: { $gte: dayStart },
  });
  const svc = served.filter((t) => t.serviceMinutes != null).map((t) => t.serviceMinutes);
  res.json({
    servedToday: served.length,
    avgServiceMinutes: svc.length ? round1(svc.reduce((a, b) => a + b, 0) / svc.length) : 0,
  });
});

// POST /api/employee/counters/:counterId/call - call the next ticket
router.post('/counters/:counterId/call', allowRoles('employee', 'admin'), async (req, res, next) => {
  const { valid, errors } = validate(req.body || {}, {
    serviceId: { type: 'string', required: true },
  });
  if (!valid) return badRequest(res, errors);
  try {
    const io = req.app.get('io');
    const store = req.app.get('store');
    const ticket = await engine.callNext(io, store, {
      serviceId: req.body.serviceId,
      counterId: req.params.counterId,
      employeeId: req.user.sub,
    });
    await store.update('tickets', { _id: ticket._id }, { $set: { servedBy: req.user.sub } });
    res.json({ ticket });
  } catch (err) {
    next(err);
  }
});

// POST /api/employee/tickets/:id/serve
router.post('/tickets/:id/serve', allowRoles('employee', 'admin'), async (req, res, next) => {
  try {
    const io = req.app.get('io');
    const store = req.app.get('store');
    const ticket = await engine.serveTicket(io, store, { ticketId: req.params.id, employeeId: req.user.sub });
    await store.update('tickets', { _id: ticket._id }, { $set: { servedBy: req.user.sub } });
    res.json({ ticket });
  } catch (err) {
    next(err);
  }
});

// POST /api/employee/tickets/:id/no-show
router.post('/tickets/:id/noshow', allowRoles('employee', 'admin'), async (req, res, next) => {
  try {
    const io = req.app.get('io');
    const store = req.app.get('store');
    const ticket = await engine.noShow(io, store, { ticketId: req.params.id, employeeId: req.user.sub });
    res.json({ ticket });
  } catch (err) {
    next(err);
  }
});

// POST /api/employee/tickets/:id/recall - re-announce a called ticket
router.post('/tickets/:id/recall', allowRoles('employee', 'admin'), async (req, res, next) => {
  try {
    const io = req.app.get('io');
    const store = req.app.get('store');
    const ticket = await engine.recallTicket(io, store, { ticketId: req.params.id, employeeId: req.user.sub });
    res.json({ ticket });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
