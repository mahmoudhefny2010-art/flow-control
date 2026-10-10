// ---------------------------------------------------------------------------
// MOCK LEGACY QUEUE SYSTEM
// ---------------------------------------------------------------------------
// Simulates the university's EXISTING queue system (the one we integrate with,
// never replace). It exposes its own REST API on /api/legacy/* and keeps an
// independent state, exactly like a third-party / in-house legacy platform.
//
// In production, point LEGACY_API_BASE to the real system and this mock is
// bypassed — the LegacyClient talks HTTP either way.
// ---------------------------------------------------------------------------
const express = require('express');
const crypto = require('crypto');
const { pad } = require('./util');

function createLegacyApi() {
  const router = express.Router();

  // Independent state of the "legacy" platform
  const state = {
    startedAt: new Date().toISOString(),
    queues: [
      { id: 'LG-REG', name: 'Legacy Registration Desk', building: 'Registration Hall', open: true, ticketSeq: 100 },
      { id: 'LG-ITS', name: 'Legacy IT Support', building: 'IT Center', open: true, ticketSeq: 200 },
      { id: 'LG-FIN', name: 'Legacy Treasury Window', building: 'Main Building', open: false, ticketSeq: 300 },
    ],
    tickets: [],
    audit: [],
  };

  const audit = (action, payload) => {
    state.audit.push({ id: crypto.randomUUID(), at: new Date().toISOString(), action, payload });
    if (state.audit.length > 500) state.audit.shift();
  };

  // GET /api/legacy/health
  router.get('/health', (req, res) => {
    res.json({ status: 'ok', system: 'MIU Legacy Queue System', startedAt: state.startedAt });
  });

  // GET /api/legacy/queues
  router.get('/queues', (req, res) => {
    res.json({
      queues: state.queues.map((q) => ({
        ...q,
        waiting: state.tickets.filter((t) => t.queueId === q.id && t.status === 'waiting').length,
      })),
    });
  });

  // GET /api/legacy/queues/:id/tickets
  router.get('/queues/:id/tickets', (req, res) => {
    const tickets = state.tickets
      .filter((t) => t.queueId === req.params.id)
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    res.json({ queueId: req.params.id, tickets });
  });

  // POST /api/legacy/queues/:id/tickets
  router.post('/queues/:id/tickets', express.json(), (req, res) => {
    const q = state.queues.find((x) => x.id === req.params.id);
    if (!q) return res.status(404).json({ error: 'queue not found' });
    if (!q.open) return res.status(409).json({ error: 'queue is closed' });
    const ticket = {
      id: crypto.randomUUID(),
      code: `${q.id}-${pad(q.ticketSeq++, 3)}`,
      queueId: q.id,
      studentId: req.body.studentId || 'N/A',
      priority: req.body.priority === 'high' ? 'high' : 'normal',
      status: 'waiting',
      createdAt: new Date().toISOString(),
      channel: 'legacy',
    };
    state.tickets.push(ticket);
    audit('ticket.created', { code: ticket.code });
    res.status(201).json(ticket);
  });

  // POST /api/legacy/tickets/:id/call  (legacy operator calls a ticket)
  router.post('/tickets/:id/call', express.json(), (req, res) => {
    const t = state.tickets.find((x) => x.id === req.params.id);
    if (!t) return res.status(404).json({ error: 'ticket not found' });
    t.status = 'called';
    t.calledAt = new Date().toISOString();
    audit('ticket.called', { code: t.code });
    res.json(t);
  });

  // POST /api/legacy/tickets/:id/serve
  router.post('/tickets/:id/serve', express.json(), (req, res) => {
    const t = state.tickets.find((x) => x.id === req.params.id);
    if (!t) return res.status(404).json({ error: 'ticket not found' });
    t.status = 'served';
    t.servedAt = new Date().toISOString();
    audit('ticket.served', { code: t.code });
    res.json(t);
  });

  // GET /api/legacy/audit
  router.get('/audit', (req, res) => res.json({ audit: state.audit.slice(-50) }));

  // Expose internals for the integration layer (same process, but accessed
  // through HTTP by LegacyClient to prove real API-level integration).
  return { router, state };
}

module.exports = { createLegacyApi };
