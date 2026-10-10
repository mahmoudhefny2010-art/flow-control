// Ticket routes: my tickets, ticket detail, public verify, feedback
const express = require('express');
const { validate, badRequest } = require('../lib/validate');
const { allowRoles } = require('../lib/auth');
const engine = require('../lib/queueEngine');
const { id, minutesBetween, round1 } = require('../lib/util');

const router = express.Router();

// GET /api/tickets/mine - tickets of the logged-in user
router.get('/mine', allowRoles('student', 'employee', 'admin'), async (req, res) => {
  const store = req.app.get('store');
  const tickets = await store.find('tickets', { userId: req.user.sub }, { sort: { createdAt: -1 } });
  // Enrich with ETA for waiting tickets
  const out = [];
  for (const t of tickets.slice(0, 30)) {
    const service = await store.findOne('services', { _id: t.serviceId });
    let eta = null;
    if (t.status === 'waiting' && service) {
      eta = await engine.estimateWait(store, service, t.position || 1);
    }
    const counters = t.counterId ? await store.findOne('counters', { _id: t.counterId }) : null;
    out.push({ ...t, etaMinutes: eta, counter: counters ? counters.name : null });
  }
  res.json({ tickets: out });
});

// GET /api/tickets/:id - ticket detail (owner or staff)
router.get('/:id', allowRoles('student', 'employee', 'admin'), async (req, res) => {
  const store = req.app.get('store');
  const ticket = await store.findOne('tickets', { _id: req.params.id });
  if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
  const isOwner = ticket.userId === req.user.sub;
  const isStaff = req.user.role !== 'student';
  if (!isOwner && !isStaff) return res.status(403).json({ error: 'Forbidden' });
  const service = await store.findOne('services', { _id: ticket.serviceId });
  let eta = null;
  if (ticket.status === 'waiting' && service) {
    eta = await engine.estimateWait(store, service, ticket.position || 1);
  }
  const counter = ticket.counterId ? await store.findOne('counters', { _id: ticket.counterId }) : null;
  const feedback = await store.findOne('feedback', { ticketId: ticket._id });
  res.json({ ticket: { ...ticket, etaMinutes: eta }, counter: counter ? counter.name : null, feedback });
});

// Public ticket verification (no auth) - used by QR codes
router.get('/:id/public', async (req, res) => {
  const store = req.app.get('store');
  const ticket = await store.findOne('tickets', { _id: req.params.id });
  if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
  res.json({
    code: ticket.code,
    service: ticket.serviceName,
    building: ticket.building,
    status: ticket.status,
    position: ticket.position,
    createdAt: ticket.createdAt,
  });
});

// POST /api/tickets/:id/cancel
router.post('/:id/cancel', allowRoles('student', 'employee', 'admin'), async (req, res, next) => {
  try {
    const io = req.app.get('io');
    const store = req.app.get('store');
    const ticket = await store.findOne('tickets', { _id: req.params.id });
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
    if (ticket.userId !== req.user.sub && req.user.role === 'student') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const updated = await engine.cancelTicket(io, store, { ticketId: ticket._id, userId: req.user.sub });
    res.json({ ticket: updated });
  } catch (err) {
    next(err);
  }
});

// POST /api/tickets/:id/feedback - submit feedback for a served ticket
router.post('/:id/feedback', allowRoles('student', 'employee', 'admin'), async (req, res) => {
  const { valid, errors } = validate(req.body || {}, {
    rating: { type: 'number', required: true, min: 1, max: 5 },
    comment: { type: 'string', max: 1000 },
  });
  if (!valid) return badRequest(res, errors);

  const store = req.app.get('store');
  const ticket = await store.findOne('tickets', { _id: req.params.id });
  if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
  if (ticket.userId !== req.user.sub && req.user.role === 'student') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const existing = await store.findOne('feedback', { ticketId: ticket._id });
  if (existing) {
    return res.status(409).json({ error: 'Feedback already submitted for this ticket' });
  }
  const fb = {
    _id: id(),
    ticketId: ticket._id,
    serviceId: ticket.serviceId,
    serviceName: ticket.serviceName,
    userId: req.user.sub,
    userName: req.user.name,
    rating: Math.round(req.body.rating),
    comment: (req.body.comment || '').trim(),
    createdAt: new Date().toISOString(),
  };
  await store.insert('feedback', fb);
  res.status(201).json({ feedback: fb });
});

module.exports = router;
