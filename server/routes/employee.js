// Employee (service desk) routes
const express = require('express');
const { createRouter } = require('../lib/asyncRouter');
const { validate, badRequest } = require('../lib/validate');
const { allowRoles } = require('../lib/auth');
const engine = require('../lib/queueEngine');
const { round1 } = require('../lib/util');

const router = createRouter();

async function requireTicketCounterAccess(req, store, ticketId) {
  const ticket = await store.findOne('tickets', { _id: ticketId });
  if (!ticket) {
    const err = new Error('Ticket not found');
    err.status = 404;
    throw err;
  }
  if (req.user.role !== 'admin') {
    const counter = ticket.counterId ? await store.findOne('counters', { _id: ticket.counterId }) : null;
    const ticketService = await store.findOne('services', { _id: ticket.serviceId });
    if (req.user.roomCode && ticketService?.code === 'REG' && ticket.roomCode !== req.user.roomCode) {
      const err = new Error('You can only operate tickets assigned to your Registrar room');
      err.status = 403;
      throw err;
    }
    if (!counter || (counter.employeeId && counter.employeeId !== req.user.sub)) {
      const err = new Error('This ticket is assigned to another counter');
      err.status = 403;
      throw err;
    }
  }
  return ticket;
}

// GET /api/employee/queues - queues the employee serves
router.get('/queues', allowRoles('employee', 'registrar-staff', 'admin'), async (req, res) => {
  const store = req.app.get('store');
  let services;
  if (req.user.role === 'admin') {
    services = await store.find('services', { active: true }, { sort: { name: 1 } });
  } else if (req.user.role === 'registrar-staff') {
    services = await store.find('services', { active: true, code: 'REG' });
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
    const rawCounters = await store.find('counters', { serviceId: s._id });
    const counters = s.code === 'REG' ? engine.resolveRegistrarCounters(rawCounters) : rawCounters;
    const rooms = s.code === 'REG'
      ? (req.user.roomCode ? [req.user.roomCode] : ['OOB', 'OO7'])
      : [null];
    if (s.code === 'REG' && !rooms[0]) continue;
    for (const roomCode of rooms) {
      const roomCounters = roomCode ? counters.filter((counter) => counter.roomCode === roomCode) : counters;
      const waiting = await engine.waitingTickets(store, s._id, roomCode || undefined);
      const calledAll = await store.find('tickets', { serviceId: s._id, status: 'called' });
      const called = roomCode ? calledAll.filter((ticket) => ticket.roomCode === roomCode) : calledAll;
      const myCounters = roomCounters.filter((c) => c.employeeId === req.user.sub || req.user.role === 'admin');
      out.push({ ...s, ...(roomCode ? { roomCode, name: `${s.name} · Room ${roomCode}` } : {}), waiting, called, counters: roomCounters, myCounters });
    }
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
router.post('/counters/:counterId/call', allowRoles('employee', 'registrar-staff', 'admin'), async (req, res, next) => {
  const { valid, errors } = validate(req.body || {}, {
    serviceId: { type: 'string', required: true },
    roomCode: { type: 'enum', enum: ['OOB', 'OO7'] },
  });
  if (!valid) return badRequest(res, errors);
  try {
    const io = req.app.get('io');
    const store = req.app.get('store');
    const counter = await store.findOne('counters', { _id: req.params.counterId });
    if (!counter) return res.status(404).json({ error: 'Counter not found' });
    if (counter.serviceId !== req.body.serviceId) return res.status(400).json({ error: 'Counter does not belong to this service' });
    const service = await store.findOne('services', { _id: counter.serviceId });
    let counterRoomCode = counter.roomCode;
    if (service?.code === 'REG') {
      counterRoomCode = engine.resolveRegistrarCounters(await store.find('counters', { serviceId: service._id })).find((entry) => entry._id === counter._id)?.roomCode;
      if (!req.body.roomCode || counterRoomCode !== req.body.roomCode) return res.status(400).json({ error: 'Choose a counter assigned to this Registrar room' });
    }
    if (req.user.roomCode && service?.code === 'REG' && counterRoomCode !== req.user.roomCode) {
      return res.status(403).json({ error: 'You can only operate your assigned Registrar room' });
    }
    if (req.user.role !== 'admin' && counter.employeeId && counter.employeeId !== req.user.sub) {
      return res.status(403).json({ error: 'This counter is assigned to another employee' });
    }
    const ticket = await engine.callNext(io, store, {
      serviceId: req.body.serviceId,
      counterId: req.params.counterId,
      employeeId: req.user.sub,
      roomCode: req.body.roomCode,
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
    await requireTicketCounterAccess(req, store, req.params.id);
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
    await requireTicketCounterAccess(req, store, req.params.id);
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
    await requireTicketCounterAccess(req, store, req.params.id);
    const ticket = await engine.recallTicket(io, store, { ticketId: req.params.id, employeeId: req.user.sub });
    res.json({ ticket });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
