// Appointment intake, room queues, and registrar operations.
const crypto = require('crypto');
const { createRouter } = require('../lib/asyncRouter');
const { allowRoles } = require('../lib/auth');
const { validate, badRequest } = require('../lib/validate');
const config = require('../config');
const engine = require('../lib/queueEngine');
const { id } = require('../lib/util');
const { send } = require('../lib/emailer');

const router = createRouter();
const ROOMS = ['OOB', 'OO7'];
function localDateString(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

async function registrarService(store) {
  return store.findOne('services', { code: 'REG', active: true });
}

function roomAccess(req, roomCode) {
  if (req.user.role === 'admin') return true;
  return req.user.roomCode === roomCode;
}

function verifyAppointmentQr(value, ticket) {
  let parsed;
  try { parsed = JSON.parse(value); } catch { return false; }
  if (parsed.ticketId !== ticket._id || parsed.code !== ticket.code || !parsed.signature
    || parsed.appointmentDate !== ticket.appointmentDate) return false;
  const expected = crypto.createHmac('sha256', config.jwtSecret)
    .update(`${ticket._id}|${ticket.code}|${ticket.serviceId}|${ticket.appointmentDate}`).digest();
  let actual;
  try { actual = Buffer.from(parsed.signature, 'hex'); } catch { return false; }
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function queueOrder(a, b) {
  return (a.queueNumber || 0) - (b.queueNumber || 0)
    || String(a.createdAt).localeCompare(String(b.createdAt));
}

function belongsToRoom(ticket, roomCode) {
  return ticket.roomCode === roomCode || (!ticket.roomCode && ticket.suggestedRoomCode === roomCode);
}

async function publishRoom(io, store, serviceId, roomCode) {
  await engine.recomputePositions(store, serviceId);
  await engine.broadcastQueue(io, store, serviceId);
  const all = await store.find('tickets', { serviceId });
  const active = all.filter((ticket) => belongsToRoom(ticket, roomCode) && ['waiting', 'called'].includes(ticket.status)).sort(queueOrder);
  io.to(`room:${serviceId}:${roomCode}`).emit('registrar:room-updated', {
    roomCode,
    tickets: active,
    waiting: active.filter((ticket) => ticket.status === 'waiting'),
    called: active.filter((ticket) => ticket.status === 'called'),
  });
}

async function notifyStudent(io, store, ticket, subject, text) {
  const user = await store.findOne('users', { _id: ticket.userId });
  if (!user) return;
  if (user.preferences?.emailNotifications === false) {
    await store.insert('notifications', { _id: id(), type: 'inapp', to: user.email, userId: user._id, subject, text, channel: 'inapp', status: 'delivered', createdAt: new Date().toISOString() });
  } else {
    await send({ to: user.email, userId: user._id, subject, text });
  }
  io.to(`user:${user._id}`).emit('appointment:updated', { ticket, message: text });
}

async function audit(store, actor, action, ticket, details = {}) {
  await store.insert('auditLogs', { _id: id(), actorId: actor.sub, actorEmail: actor.email, actorRole: actor.role,
    action, entityType: 'appointment', entityId: ticket._id, appointmentNumber: ticket.appointmentNumber || ticket.code,
    details, createdAt: new Date().toISOString() });
}

// Entrance desk: QR lookup does not mutate the booking; room selection and
// completed check-in happen in the next explicit step.
router.post('/scan', allowRoles('outside-usher', 'admin'), async (req, res) => {
  const { valid, errors } = validate(req.body || {}, { qrValue: { type: 'string', required: true, max: 2000 } });
  if (!valid) return badRequest(res, errors);
  let qr;
  try { qr = JSON.parse(req.body.qrValue); } catch { return res.status(400).json({ error: 'This is not a valid appointment QR code' }); }
  const scanTime = new Date();
  if (!qr.ticketId) return res.status(400).json({ error: 'This is not a valid appointment QR code' });
  const store = req.app.get('store');
  const ticket = await store.findOne('tickets', { _id: qr.ticketId });
  const service = await registrarService(store);
  if (!ticket || ticket.serviceId !== service?._id || !ticket.appointmentNumber) {
    return res.status(404).json({ error: 'Appointment QR is invalid or was not issued by QueueFlow' });
  }
  if (ticket.appointmentDate !== localDateString(scanTime)) {
    return res.status(403).json({ error: 'This appointment QR is valid only on its appointment day' });
  }
  if (scanTime.getHours() < 8 || scanTime.getHours() >= 15) {
    return res.status(403).json({ error: 'New QR check-ins are available from 8:00 AM to 3:00 PM. Appointments checked in before 3:00 PM can continue in the room queue.' });
  }
  if (!verifyAppointmentQr(req.body.qrValue, ticket, scanTime)) {
    return res.status(403).json({ error: 'This QR is invalid. Open the ticket for today or ask the student to search by name or ID.' });
  }
  if (!['waiting', 'called'].includes(ticket.status) || ticket.appointmentStatus === 'completed') {
    return res.status(409).json({ error: 'This appointment is no longer active' });
  }
  const scannedAt = new Date().toISOString();
  await store.update('tickets', { _id: ticket._id }, { $set: { frontDeskVerifiedAt: scannedAt, verificationMethod: 'qr', qrScannedBy: req.user.sub } });
  const verified = await store.findOne('tickets', { _id: ticket._id });
  await audit(store, req.user, 'qr-verified', verified, { method: 'qr' });
  res.json({ ticket: verified });
});

router.get('/search', allowRoles('outside-usher', 'admin'), async (req, res) => {
  const query = String(req.query.q || '').trim().toLowerCase();
  if (query.length < 2) return res.json({ appointments: [] });
  const store = req.app.get('store');
  const service = await registrarService(store);
  if (!service) return res.json({ appointments: [] });
  const tickets = await store.find('tickets', { serviceId: service._id });
  const appointments = tickets.filter((ticket) => Boolean(ticket.appointmentNumber) && ['waiting', 'called'].includes(ticket.status)
    && [ticket.userName, ticket.studentId, ticket.code, ticket.appointmentNumber, ticket.registrarProfile?.certificateType]
      .some((value) => String(value || '').toLowerCase().includes(query)))
    .sort(queueOrder).slice(0, 20);
  res.json({ appointments });
});

router.get('/appointments/:ticketId', allowRoles('outside-usher', 'admin'), async (req, res) => {
  const store = req.app.get('store');
  const service = await registrarService(store);
  const ticket = await store.findOne('tickets', { _id: req.params.ticketId });
  if (!ticket || ticket.serviceId !== service?._id || !ticket.appointmentNumber) return res.status(404).json({ error: 'Appointment not found' });
  res.json({ ticket });
});

router.post('/appointments/:ticketId/prepare', allowRoles('outside-usher', 'admin'), async (req, res) => {
  const store = req.app.get('store');
  const service = await registrarService(store);
  const ticket = await store.findOne('tickets', { _id: req.params.ticketId });
  if (!ticket || ticket.serviceId !== service?._id || !ticket.appointmentNumber || !['waiting', 'called'].includes(ticket.status)) return res.status(404).json({ error: 'Active appointment not found' });
  await store.update('tickets', { _id: ticket._id }, { $set: { frontDeskVerifiedAt: new Date().toISOString(), verificationMethod: 'manual-search', qrScannedBy: req.user.sub } });
  const prepared = await store.findOne('tickets', { _id: ticket._id });
  await audit(store, req.user, 'appointment-verified-by-search', prepared, { method: 'manual-search', policy: 'manual identity check; QR freshness/time rules do not apply' });
  res.json({ ticket: prepared });
});

router.get('/admin/appointments', allowRoles('admin'), async (req, res) => {
  const store = req.app.get('store');
  const service = await registrarService(store);
  if (!service) return res.json({ appointments: [], summary: {} });
  const all = (await store.find('tickets', { serviceId: service._id })).filter((ticket) => Boolean(ticket.appointmentNumber));
  const date = String(req.query.date || '');
  const status = String(req.query.status || '');
  const room = String(req.query.room || '');
  const query = String(req.query.q || '').trim().toLowerCase();
  const appointments = all.filter((ticket) => (!date || ticket.appointmentDate === date)
    && (!status || ticket.appointmentStatus === status)
    && (!room || ticket.roomCode === room || ticket.suggestedRoomCode === room)
    && (!query || [ticket.userName, ticket.studentId, ticket.code, ticket.appointmentNumber, ticket.registrarProfile?.major]
      .some((value) => String(value || '').toLowerCase().includes(query))))
    .sort(queueOrder).slice(0, 500);
  const summary = all.reduce((counts, ticket) => {
    const key = ticket.appointmentStatus || 'booked'; counts[key] = (counts[key] || 0) + 1;
    const roomKey = ticket.roomCode || ticket.suggestedRoomCode || 'unassigned';
    counts[`room:${roomKey}`] = (counts[`room:${roomKey}`] || 0) + 1;
    return counts;
  }, {});
  res.json({ appointments, summary });
});

router.get('/admin/audit', allowRoles('admin'), async (req, res) => {
  const logs = await req.app.get('store').find('auditLogs', {}, { sort: { createdAt: -1 }, limit: 200 });
  res.json({ logs });
});

router.post('/check-in', allowRoles('outside-usher', 'admin'), async (req, res) => {
  const { valid, errors } = validate(req.body || {}, {
    ticketId: { type: 'string', required: true },
    roomCode: { type: 'enum', required: true, enum: ROOMS },
  });
  if (!valid) return badRequest(res, errors);
  const store = req.app.get('store');
  const service = await registrarService(store);
  const ticket = await store.findOne('tickets', { _id: req.body.ticketId });
  if (!ticket || ticket.serviceId !== service?._id || !ticket.appointmentNumber) return res.status(404).json({ error: 'Appointment not found' });
  if (!['waiting', 'called'].includes(ticket.status)) return res.status(409).json({ error: 'Appointment is no longer active' });
  if (ticket.arrivedAt || ticket.arrivalStatus === 'arrived') return res.status(409).json({ error: 'This appointment has already checked in' });
  if (ticket.appointmentDate !== localDateString() || new Date().getHours() >= 15) return res.status(403).json({ error: 'Students must complete entrance check-in by 3:00 PM on their appointment day. Bookings do not keep a room open after closing.' });
  const verifiedAt = ticket.frontDeskVerifiedAt ? Date.parse(ticket.frontDeskVerifiedAt) : 0;
  if (!verifiedAt || Date.now() - verifiedAt > 5 * 60 * 1000) return res.status(409).json({ error: 'Scan or verify this appointment at the entrance before check-in' });
  const now = new Date().toISOString();
  await store.update('tickets', { _id: ticket._id }, { $set: {
    roomCode: req.body.roomCode,
    arrivalStatus: 'arrived',
    appointmentStatus: 'checked-in',
    arrivedAt: now,
    checkInAt: now,
    roomAssignedAt: now,
    frontDeskVerifiedAt: null,
    updatedAt: now,
  } });
  const checkedIn = await store.findOne('tickets', { _id: ticket._id });
  await audit(store, req.user, 'checked-in-and-room-assigned', checkedIn, { roomCode: req.body.roomCode, method: ticket.verificationMethod });
  await publishRoom(req.app.get('io'), store, service._id, req.body.roomCode);
  const io = req.app.get('io');
  await notifyStudent(io, store, checkedIn, 'Appointment checked in', `Checked in. Go to room ${req.body.roomCode}.`);
  res.json({ ticket: checkedIn });
});

router.post('/appointments/walk-in-check-in', allowRoles('outside-usher', 'room-usher', 'admin'), async (req, res) => {
  const { valid, errors } = validate(req.body || {}, { ticketId: { type: 'string', required: true } });
  if (!valid) return badRequest(res, errors);
  const store = req.app.get('store'); const service = await registrarService(store);
  const ticket = await store.findOne('tickets', { _id: req.body.ticketId });
  if (!ticket || ticket.serviceId !== service?._id || ticket.registrarProfile?.statusSource !== 'usher-entered') return res.status(404).json({ error: 'Walk-in appointment not found' });
  if (ticket.appointmentDate !== localDateString() || new Date().getHours() >= 15) return res.status(403).json({ error: 'Walk-in check-in is available only before 3:00 PM today' });
  const roomCode = ticket.suggestedRoomCode;
  if (req.user.role === 'room-usher' && req.user.roomCode !== roomCode) return res.status(403).json({ error: 'You can only check in students for your assigned room' });
  const now = new Date().toISOString();
  await store.update('tickets', { _id: ticket._id }, { $set: { roomCode, arrivalStatus: 'arrived', appointmentStatus: 'checked-in', arrivedAt: now, checkInAt: now, roomAssignedAt: now, verificationMethod: 'walk-in', updatedAt: now } });
  const checkedIn = await store.findOne('tickets', { _id: ticket._id });
  await audit(store, req.user, 'walk-in-registered-and-checked-in', checkedIn, { roomCode });
  await publishRoom(req.app.get('io'), store, service._id, roomCode);
  res.status(201).json({ ticket: checkedIn });
});

router.get('/rooms/:roomCode', allowRoles('room-usher', 'registrar-staff', 'admin'), async (req, res) => {
  const { roomCode } = req.params;
  if (!ROOMS.includes(roomCode)) return res.status(404).json({ error: 'Room not found' });
  if (!roomAccess(req, roomCode)) return res.status(403).json({ error: 'You can only access your assigned room' });
  const store = req.app.get('store');
  const service = await registrarService(store);
  if (!service) return res.status(404).json({ error: 'Registrar service is not configured' });
  const date = String(req.query.date || localDateString());
  const tickets = (await store.find('tickets', { serviceId: service._id, appointmentDate: date })).filter((ticket) => belongsToRoom(ticket, roomCode));
  const active = tickets.filter((ticket) => ['waiting', 'called'].includes(ticket.status)).sort(queueOrder);
  res.json({ roomCode, service: { _id: service._id, name: service.name }, date, tickets: active,
    waiting: active.filter((ticket) => ticket.status === 'waiting'), called: active.filter((ticket) => ticket.status === 'called') });
});

router.post('/rooms/:roomCode/attendance/:ticketId', allowRoles('room-usher', 'registrar-staff', 'admin'), async (req, res) => {
  const { roomCode, ticketId } = req.params;
  if (!ROOMS.includes(roomCode)) return res.status(404).json({ error: 'Room not found' });
  if (!roomAccess(req, roomCode)) return res.status(403).json({ error: 'You can only access your assigned room' });
  const store = req.app.get('store');
  const candidate = await store.findOne('tickets', { _id: ticketId });
  const ticket = candidate && belongsToRoom(candidate, roomCode) ? candidate : null;
  if (!ticket) return res.status(404).json({ error: 'Student is not assigned to this room' });
  if (ticket.arrivalStatus === 'arrived') return res.status(409).json({ error: 'Attendance is already recorded' });
  if (ticket.appointmentDate !== localDateString() || new Date().getHours() >= 15) return res.status(403).json({ error: 'Attendance check-in closes at 3:00 PM on the appointment day' });
  const now = new Date().toISOString();
  await store.update('tickets', { _id: ticket._id }, { $set: { roomCode, arrivalStatus: 'arrived', appointmentStatus: 'checked-in', arrivedAt: now, attendanceAssistedAt: now, roomAssignedAt: ticket.roomAssignedAt || now, updatedAt: now } });
  const service = await registrarService(store);
  const updated = await store.findOne('tickets', { _id: ticket._id });
  await audit(store, req.user, 'attendance-assisted', updated, { roomCode });
  await publishRoom(req.app.get('io'), store, service._id, roomCode);
  res.json({ ticket: updated });
});

router.post('/rooms/:roomCode/call-next', allowRoles('registrar-staff', 'admin'), async (req, res) => {
  const { roomCode } = req.params;
  if (!ROOMS.includes(roomCode)) return res.status(404).json({ error: 'Room not found' });
  if (!roomAccess(req, roomCode)) return res.status(403).json({ error: 'You can only operate your assigned room' });
  const store = req.app.get('store');
  const service = await registrarService(store);
  const today = localDateString();
  const tickets = (await store.find('tickets', { serviceId: service._id, appointmentDate: today, status: 'waiting' })).filter((ticket) => belongsToRoom(ticket, roomCode)).sort(queueOrder);
  const activeCall = await store.findOne('tickets', { serviceId: service._id, roomCode, status: 'called' });
  if (activeCall) return res.status(409).json({ error: `Finish the current student ${activeCall.code} first` });
  const now = new Date();
  const ready = [];
  for (const ticket of tickets) {
    if (ticket.timeSlot && ticket.timeSlot > `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`) continue;
    if (ticket.arrivalStatus === 'arrived') ready.push(ticket);
    else if (ticket.appointmentStatus !== 'pending') {
      await store.update('tickets', { _id: ticket._id }, { $set: { appointmentStatus: 'pending', pendingAt: new Date().toISOString(), updatedAt: new Date().toISOString() } });
      await audit(store, req.user, 'appointment-marked-pending', ticket, { roomCode });
    }
  }
  if (!ready.length) {
    await publishRoom(req.app.get('io'), store, service._id, roomCode);
    return res.status(409).json({ error: 'No checked-in appointment is ready to call' });
  }
  const ticket = ready[0];
  const nowIso = now.toISOString();
  const counter = engine.resolveRegistrarCounters(await store.find('counters', { serviceId: service._id })).find((item) => item.roomCode === roomCode && item.status === 'open');
  await store.update('tickets', { _id: ticket._id }, { $set: {
    status: 'called', appointmentStatus: 'called', calledAt: nowIso,
    counterId: counter?._id || null, counterName: counter?.name || `Room ${roomCode}`,
    updatedAt: nowIso,
  } });
  const called = await store.findOne('tickets', { _id: ticket._id });
  await audit(store, req.user, 'appointment-called', called, { roomCode });
  await publishRoom(req.app.get('io'), store, service._id, roomCode);
  await notifyStudent(req.app.get('io'), store, called, 'Registrar is ready', `Registrar is ready for you in room ${roomCode}.`);
  res.json({ ticket: called });
});

router.post('/rooms/:roomCode/complete/:ticketId', allowRoles('registrar-staff', 'admin'), async (req, res) => {
  const { roomCode, ticketId } = req.params;
  if (!ROOMS.includes(roomCode)) return res.status(404).json({ error: 'Room not found' });
  if (!roomAccess(req, roomCode)) return res.status(403).json({ error: 'You can only operate your assigned room' });
  const store = req.app.get('store');
  const ticket = await store.findOne('tickets', { _id: ticketId, roomCode, status: 'called' });
  if (!ticket) return res.status(404).json({ error: 'Called appointment not found in this room' });
  const now = new Date().toISOString();
  await store.update('tickets', { _id: ticket._id }, { $set: { status: 'served', appointmentStatus: 'completed', completedAt: now, servedAt: now, updatedAt: now } });
  const completed = await store.findOne('tickets', { _id: ticket._id });
  await audit(store, req.user, 'appointment-completed', completed, { roomCode });
  await publishRoom(req.app.get('io'), store, ticket.serviceId, roomCode);
  await notifyStudent(req.app.get('io'), store, completed, 'Appointment completed', 'Your Registrar appointment is complete.');
  res.json({ ticket: completed });
});

router.post('/rooms/:roomCode/skip/:ticketId', allowRoles('admin'), async (req, res) => {
  const { roomCode, ticketId } = req.params;
  const store = req.app.get('store');
  const ticket = await store.findOne('tickets', { _id: ticketId, roomCode, status: 'called' });
  if (!ticket) return res.status(404).json({ error: 'Called appointment not found' });
  const now = new Date().toISOString();
  await store.update('tickets', { _id: ticket._id }, { $set: { status: 'no-show', appointmentStatus: 'pending', skippedAt: now, updatedAt: now } });
  await audit(store, req.user, 'appointment-skipped-by-admin', ticket, { roomCode });
  const service = await registrarService(store);
  await publishRoom(req.app.get('io'), store, service._id, roomCode);
  res.json({ ok: true });
});

module.exports = router;
