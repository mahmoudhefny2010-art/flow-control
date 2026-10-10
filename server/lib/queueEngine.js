// ---------------------------------------------------------------------------
// QUEUE ENGINE
// ---------------------------------------------------------------------------
// Core domain logic: ticket codes, priority-weighted ordering, positions,
// counter operations (call next / serve / no-show), ETA estimation.
// Priority model: a high-priority ticket is treated as if it arrived
// PRIORITY_BOOST_MIN earlier, so it jumps the queue fairly without
// starving normal tickets.
// ---------------------------------------------------------------------------
const config = require('../config');
const { id, pad, startOfDay, endOfDay, minutesBetween, round1 } = require('./util');
const { send } = require('./emailer');

const EVENT = {
  ticketCreated: 'ticket:created',
  ticketCalled: 'ticket:called',
  ticketServed: 'ticket:served',
  ticketCancelled: 'ticket:cancelled',
  ticketNoShow: 'ticket:noshow',
  queueUpdated: 'queue:updated',
  alert: 'alert',
};

// --- helpers ---------------------------------------------------------------

function sortByScore(tickets) {
  const boost = config.priorityBoostMinutes * 60000;
  return [...tickets].sort((a, b) => {
    const sa = new Date(a.createdAt).getTime() - (a.priority === 'high' ? boost : 0);
    const sb = new Date(b.createdAt).getTime() - (b.priority === 'high' ? boost : 0);
    return sa - sb;
  });
}

async function waitingTickets(store, serviceId) {
  const all = await store.find('tickets', { serviceId, status: 'waiting' });
  return sortByScore(all);
}

async function recomputePositions(store, serviceId) {
  const waiting = await waitingTickets(store, serviceId);
  const now = new Date().toISOString();
  for (let i = 0; i < waiting.length; i += 1) {
    if (waiting[i].position !== i + 1) {
      await store.update('tickets', { _id: waiting[i]._id }, { $set: { position: i + 1, updatedAt: now } });
    }
  }
  return waiting;
}

async function openCountersFor(store, serviceId) {
  const counters = await store.find('counters', { serviceId });
  return counters.filter((c) => c.status === 'open');
}

async function estimateWait(store, service, position) {
  const open = (await openCountersFor(store, service._id)).length || 1;
  const perCounter = Math.max(1, Math.ceil(position / open));
  return round1(perCounter * (service.avgServiceMinutes || 5));
}

// Broadcast a fresh snapshot of a service queue to subscribers
async function broadcastQueue(io, store, serviceId) {
  const service = await store.findOne('services', { _id: serviceId });
  const waiting = await recomputePositions(store, serviceId);
  const called = await store.find('tickets', {
    serviceId,
    status: 'called',
  });
  const servedToday = await store.count('tickets', {
    serviceId,
    status: 'served',
    createdAt: { $gte: startOfDay().toISOString() },
  });
  io.to(`service:${serviceId}`).emit(EVENT.queueUpdated, {
    service,
    waiting,
    called,
    servedToday,
    waitingCount: waiting.length,
  });
}

async function notifyUser(store, userId, subject, text) {
  const user = await store.findOne('users', { _id: userId });
  if (!user) return;
  if (user.preferences && user.preferences.emailNotifications !== false) {
    await send({ to: user.email, userId: user._id, subject, text });
  } else {
    // still create an in-app notification
    await store.insert('notifications', {
      _id: id(), type: 'inapp', to: user.email, userId: user._id,
      subject, text, channel: 'inapp', status: 'delivered',
      createdAt: new Date().toISOString(),
    });
  }
}

async function checkThresholdAlert(io, store, service) {
  const waiting = await store.count('tickets', { serviceId: service._id, status: 'waiting' });
  if (waiting >= config.queueAlertThreshold && !service.alertedAt) {
    await store.update('services', { _id: service._id }, { $set: { alertedAt: new Date().toISOString() } });
    const admins = await store.find('users', { role: 'admin' });
    const msg = `Queue alert: ${service.name} has ${waiting} waiting (threshold ${config.queueAlertThreshold})`;
    for (const admin of admins) {
      await notifyUser(store, admin._id, 'Queue threshold exceeded', msg);
    }
    io.to('admin').emit(EVENT.alert, { service, waiting, message: msg });
  }
  if (waiting < config.queueAlertThreshold && service.alertedAt) {
    await store.update('services', { _id: service._id }, { $set: { alertedAt: null } });
  }
}

// --- public operations -----------------------------------------------------

async function joinQueue(io, store, { serviceId, userId, priority = 'normal', note = '' }) {
  const service = await store.findOne('services', { _id: serviceId, active: true });
  if (!service) {
    const err = new Error('Service not found or inactive');
    err.status = 404;
    throw err;
  }
  if (service.priorityEnabled !== true && priority === 'high') {
    priority = 'normal';
  }

  const user = await store.findOne('users', { _id: userId });

  // Prevent duplicate active tickets for the same user + service
  const existing = await store.find('tickets', {
    serviceId,
    userId,
    status: { $in: ['waiting', 'called'] },
  });
  if (existing.length > 0) {
    const err = new Error('You already have an active ticket for this service');
    err.status = 409;
    err.ticket = existing[0];
    throw err;
  }

  // Ticket code: SERVICE-prefix + daily sequence
  const dayKey = new Date().toISOString().slice(0, 10);
  const seqDoc = await store.findOne('settings', { _id: `seq:${service.code}:${dayKey}` });
  const seq = ((seqDoc && seqDoc.value) || 0) + 1;
  await store.update('settings', { _id: `seq:${service.code}:${dayKey}` }, { $set: { value: seq } }, { upsert: true });

  const ticket = {
    _id: id(),
    code: `${service.code}-${pad(seq, 3)}`,
    serviceId,
    serviceName: service.name,
    building: service.building,
    userId,
    userName: user ? user.name : 'Walk-in',
    userEmail: user ? user.email : '',
    priority,
    note,
    status: 'waiting',
    position: 0,
    channel: 'web',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await store.insert('tickets', ticket);

  const waiting = await recomputePositions(store, serviceId);
  ticket.position = (waiting.find((t) => t._id === ticket._id) || {}).position || waiting.length;
  ticket.etaMinutes = await estimateWait(store, service, ticket.position);

  io.to(`service:${serviceId}`).emit(EVENT.ticketCreated, ticket);
  await broadcastQueue(io, store, serviceId);
  await checkThresholdAlert(io, store, service);

  await notifyUser(
    store,
    userId,
    `Ticket ${ticket.code} booked - ${service.name}`,
    `Your ticket ${ticket.code} for ${service.name} (${service.building}) is confirmed. Position: ${ticket.position}. Estimated wait: ~${ticket.etaMinutes} minutes.`,
  );
  return ticket;
}

async function callNext(io, store, { serviceId, counterId, employeeId }) {
  const counter = await store.findOne('counters', { _id: counterId });
  if (!counter) {
    const err = new Error('Counter not found');
    err.status = 404;
    throw err;
  }
  if (counter.status !== 'open') {
    const err = new Error('Counter is closed');
    err.status = 409;
    throw err;
  }

  // Auto no-show: if this counter has a called ticket older than CALL_TIMEOUT_MIN
  const stale = await store.find('tickets', {
    counterId,
    status: 'called',
    calledAt: { $lte: new Date(Date.now() - config.callTimeoutMinutes * 60000).toISOString() },
  });
  for (const t of stale) {
    await store.update('tickets', { _id: t._id }, {
      $set: { status: 'no-show', updatedAt: new Date().toISOString() },
    });
    io.to(`service:${serviceId}`).emit(EVENT.ticketNoShow, t);
    await notifyUser(store, t.userId, `Ticket ${t.code} marked as no-show`,
      `Your ticket ${t.code} was not picked up at counter ${counter.name} and was marked as no-show. Please book a new ticket if you still need service.`);
  }

  const waiting = await waitingTickets(store, serviceId);
  if (waiting.length === 0) {
    const err = new Error('No tickets waiting');
    err.status = 409;
    throw err;
  }
  const ticket = waiting[0];

  const now = new Date().toISOString();
  await store.update('tickets', { _id: ticket._id }, {
    $set: {
      status: 'called',
      calledAt: now,
      counterId,
      counterName: counter.name,
      updatedAt: now,
      waitMinutes: minutesBetween(ticket.createdAt, now),
    },
  });

  const updated = await store.findOne('tickets', { _id: ticket._id });
  io.to(`service:${serviceId}`).emit(EVENT.ticketCalled, updated);
  io.to(`ticket:${ticket._id}`).emit(EVENT.ticketCalled, updated);
  await broadcastQueue(io, store, serviceId);

  await notifyUser(
    store,
    ticket.userId,
    `Your ticket ${ticket.code} is being called`,
    `Please proceed to ${counter.name} (${ticket.building}) — your ticket ${ticket.code} is now being served.`,
  );
  return updated;
}

async function serveTicket(io, store, { ticketId, employeeId }) {
  const ticket = await store.findOne('tickets', { _id: ticketId });
  if (!ticket) {
    const err = new Error('Ticket not found');
    err.status = 404;
    throw err;
  }
  if (ticket.status === 'served') return ticket;

  const now = new Date().toISOString();
  await store.update('tickets', { _id: ticket._id }, {
    $set: {
      status: 'served',
      servedAt: now,
      completedAt: now,
      updatedAt: now,
      serviceMinutes: ticket.calledAt
        ? minutesBetween(ticket.calledAt, now)
        : (ticket.serviceMinutes || 0),
    },
  });

  const updated = await store.findOne('tickets', { _id: ticket._id });
  io.to(`service:${ticket.serviceId}`).emit(EVENT.ticketServed, updated);
  io.to(`ticket:${ticket._id}`).emit(EVENT.ticketServed, updated);
  await broadcastQueue(io, store, ticket.serviceId);

  await notifyUser(
    store,
    ticket.userId,
    `Service completed - ${ticket.serviceName}`,
    `Your visit for ticket ${ticket.code} is complete. Thank you for using MIU QueueFlow! We would appreciate your feedback.`,
  );
  return updated;
}

async function noShow(io, store, { ticketId, employeeId }) {
  const ticket = await store.findOne('tickets', { _id: ticketId });
  if (!ticket) {
    const err = new Error('Ticket not found');
    err.status = 404;
    throw err;
  }
  const now = new Date().toISOString();
  await store.update('tickets', { _id: ticket._id }, {
    $set: { status: 'no-show', updatedAt: now },
  });
  const updated = await store.findOne('tickets', { _id: ticket._id });
  io.to(`service:${ticket.serviceId}`).emit(EVENT.ticketNoShow, updated);
  await broadcastQueue(io, store, ticket.serviceId);
  await notifyUser(store, ticket.userId, `Ticket ${ticket.code} marked as no-show`,
    `Your ticket ${ticket.code} was marked as no-show at ${ticket.building}. Please book a new ticket if needed.`);
  return updated;
}

async function recallTicket(io, store, { ticketId, employeeId }) {
  const ticket = await store.findOne('tickets', { _id: ticketId });
  if (!ticket || ticket.status !== 'called') {
    const err = new Error('Only called tickets can be re-called');
    err.status = 409;
    throw err;
  }
  const now = new Date().toISOString();
  await store.update('tickets', { _id: ticket._id }, {
    $set: { calledAt: now, updatedAt: now },
  });
  const updated = await store.findOne('tickets', { _id: ticket._id });
  io.to(`service:${ticket.serviceId}`).emit(EVENT.ticketCalled, updated);
  io.to(`ticket:${ticket._id}`).emit(EVENT.ticketCalled, updated);
  await broadcastQueue(io, store, ticket.serviceId);
  return updated;
}

async function cancelTicket(io, store, { ticketId, userId }) {
  const ticket = await store.findOne('tickets', { _id: ticketId });
  if (!ticket) {
    const err = new Error('Ticket not found');
    err.status = 404;
    throw err;
  }
  if (ticket.status !== 'waiting') {
    const err = new Error('Only waiting tickets can be cancelled');
    err.status = 409;
    throw err;
  }
  const now = new Date().toISOString();
  await store.update('tickets', { _id: ticket._id }, {
    $set: { status: 'cancelled', updatedAt: now },
  });
  const updated = await store.findOne('tickets', { _id: ticket._id });
  io.to(`service:${ticket.serviceId}`).emit(EVENT.ticketCancelled, updated);
  await broadcastQueue(io, store, ticket.serviceId);
  return updated;
}

/**
 * Sync tickets FROM the legacy system into our store.
 * Tickets already present (matched by externalId) are updated, new ones inserted.
 */
async function syncFromLegacy(io, store, legacyClient) {
  const { queues } = await legacyClient.listQueues();
  let created = 0;
  let updated = 0;

  for (const q of queues) {
    // Find or create the matching service
    let service = await store.findOne('services', { legacyQueueId: q.id });
    if (!service) {
      service = {
        _id: id(),
        code: q.id.replace('LG-', 'L'),
        name: q.name,
        category: 'Legacy',
        building: q.building,
        floor: '',
        room: '',
        map: { x: 50, y: 50 },
        description: `Imported from legacy system queue ${q.id}`,
        avgServiceMinutes: 7,
        priorityEnabled: false,
        active: q.open,
        legacyQueueId: q.id,
        createdAt: new Date().toISOString(),
      };
      await store.insert('services', service);
      created += 1;
    } else if (service.active !== q.open) {
      await store.update('services', { _id: service._id }, { $set: { active: q.open } });
      updated += 1;
    }

    // Pull tickets
    const { tickets } = await legacyClient.queueTickets(q.id);
    for (const lt of tickets) {
      const existing = await store.findOne('tickets', { externalId: lt.id });
      const mapped = {
        code: lt.code,
        serviceId: service._id,
        serviceName: service.name,
        building: service.building,
        userName: lt.studentId,
        userEmail: '',
        userId: null,
        priority: lt.priority,
        note: '',
        status: lt.status,
        channel: 'legacy',
        externalId: lt.id,
        createdAt: lt.createdAt,
        updatedAt: new Date().toISOString(),
      };
      if (!existing) {
        mapped._id = id();
        await store.insert('tickets', mapped);
        created += 1;
      } else if (existing.status !== lt.status) {
        await store.update('tickets', { _id: existing._id }, { $set: mapped });
        updated += 1;
      }
    }
    await recomputePositions(store, service._id);
    await broadcastQueue(io, store, service._id);
  }
  return { created, updated, queues: queues.length };
}

module.exports = {
  EVENT,
  joinQueue,
  callNext,
  serveTicket,
  noShow,
  recallTicket,
  cancelTicket,
  recomputePositions,
  estimateWait,
  broadcastQueue,
  syncFromLegacy,
  waitingTickets,
};
