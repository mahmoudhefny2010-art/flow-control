// Services & booking routes
const express = require('express');
const { createRouter } = require('../lib/asyncRouter');
const { validate, badRequest } = require('../lib/validate');
const { allowRoles } = require('../lib/auth');
const engine = require('../lib/queueEngine');
const { id } = require('../lib/util');
const QRCode = require('qrcode');
const crypto = require('crypto');
const config = require('../config');

const router = createRouter();
const APPOINTMENT_SLOTS = Array.from({ length: 14 }, (_, index) => {
  const minutes = 8 * 60 + index * 30;
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
});
const APPOINTMENT_SLOT_CAPACITY = 20;
const CLOSED_DAYS = ['friday', 'saturday'];
async function registrarBookingSettings(store) {
  const record = await store.findOne('settings', { _id: 'registrar:booking' });
  return { enabled: record?.value?.enabled !== false, closedDays: Array.isArray(record?.value?.closedDays) ? record.value.closedDays : CLOSED_DAYS };
}
function isClosedDay(date, closedDays) {
  const day = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][date.getDay()];
  return closedDays.includes(day);
}
function localDateString(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function parseAppointmentDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return null;
  const date = new Date(`${value}T00:00:00`);
  const formatted = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  return Number.isNaN(date.getTime()) || formatted !== value ? null : date;
}

// GET /api/services/:id/slots?date=YYYY-MM-DD
router.get('/:id/slots', async (req, res) => {
  const store = req.app.get('store');
  const service = await store.findOne('services', { _id: req.params.id, active: true, code: 'REG' });
  if (!service) return res.status(404).json({ error: 'Registrar service not found' });
  const date = req.query.date;
  if (!parseAppointmentDate(date)) {
    return res.status(400).json({ error: 'Choose a valid appointment date' });
  }
  const selected = parseAppointmentDate(date);
  if (date !== localDateString()) {
    return res.status(400).json({ error: 'Appointments can only be booked for today' });
  }
  const settings = await registrarBookingSettings(store);
  const now = new Date();
  const isClosed = !settings.enabled || isClosedDay(selected, settings.closedDays);
  if (isClosed) return res.json({ date, slots: [], bookingOpen: false, opensAt: '08:00', closesAt: '15:00', closedDay: true, message: 'Registrar booking is closed today' });
  const tickets = await store.find('tickets', { serviceId: service._id, appointmentDate: date, status: { $ne: 'cancelled' } });
  const slots = APPOINTMENT_SLOTS.map((time) => {
    const booked = tickets.filter((ticket) => ticket.timeSlot === time).length;
    const slotDate = new Date(`${date}T${time}:00`);
    const available = now.getHours() < 15 && booked < APPOINTMENT_SLOT_CAPACITY && (now.getHours() < 8 || slotDate > now);
    return { time, booked, capacity: APPOINTMENT_SLOT_CAPACITY, available };
  });
  res.json({ date, slots, bookingOpen: settings.enabled && !isClosedDay(selected, settings.closedDays) && now.getHours() >= 8 && now.getHours() < 15, opensAt: '08:00', closesAt: '15:00', closedDays: settings.closedDays });
});

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
    const estimatedWaitMinutes = openCounters
      ? await engine.estimateWait(store, s, waiting + 1)
      : null;
    result.push({ ...s, waiting, called, openCounters, avgWaitMinutesToday: avgWait, avgWaitSamples: waits.length, estimatedWaitMinutes });
  }
  res.json({ services: result });
});

// GET /api/services/:id - single service detail
router.get('/:id', async (req, res) => {
  const store = req.app.get('store');
  const service = await store.findOne('services', { _id: req.params.id, active: true });
  if (!service) return res.status(404).json({ error: 'Service not found' });
  const counters = await store.find('counters', { serviceId: service._id });
  res.json({ service, counters: service.code === 'REG' ? engine.resolveRegistrarCounters(counters) : counters });
});

// POST /api/services/:id/book - join the virtual queue
router.post('/:id/book', allowRoles('student', 'employee', 'admin'), async (req, res, next) => {
  const { valid, errors } = validate(req.body || {}, {
    priority: { type: 'enum', enum: ['normal', 'high'] },
    note: { type: 'string', max: 300 },
    registrarProfile: { type: 'object' },
  });
  if (!valid) return badRequest(res, errors);
  try {
    const io = req.app.get('io');
    const store = req.app.get('store');
    const service = await store.findOne('services', { _id: req.params.id, active: true });
    if (!service) return res.status(404).json({ error: 'Service not found or inactive' });
    let registrarProfile = null;
    let roomCode = null;
    let suggestedRoomCode = null;
    let appointmentDate = null;
    let timeSlot = null;
    if (service.code === 'REG') {
      const fields = validate(req.body.registrarProfile || {}, {
        major: { type: 'string', required: true, min: 2, max: 100 },
        certificateType: { type: 'enum', required: true, enum: ['general', 'american', 'ig', 'foreign'] },
        paymentStatus: { type: 'enum', required: true, enum: ['paid', 'pending'] },
        documentsStatus: { type: 'enum', required: true, enum: ['complete', 'pending'] },
        phone: { type: 'string', required: true, min: 8, max: 20 },
        appointmentDate: { type: 'string', required: true, pattern: /^\d{4}-\d{2}-\d{2}$/ },
        timeSlot: { type: 'string', required: true, pattern: /^\d{2}:\d{2}$/ },
      });
      if (!fields.valid) return badRequest(res, fields.errors);
      const user = await store.findOne('users', { _id: req.user.sub });
      const isWalkInStaff = ['outside-usher', 'room-usher'].includes(req.user.role) && req.body.registrarProfile.walkIn === true;
      const walkInFields = isWalkInStaff ? validate(req.body.registrarProfile, {
        studentName: { type: 'string', required: true, min: 2, max: 80 },
        studentId: { type: 'string', required: true, min: 3, max: 30 },
      }) : { valid: true };
      if (!walkInFields.valid) return badRequest(res, walkInFields.errors);
      if (!isWalkInStaff && (!user?.studentId || !/^\d{4}\/\d{5}$/.test(user.studentId))) {
        return res.status(400).json({ error: 'Your account must have a valid MIU ID (for example 2024/06700) before booking Registrar.' });
      }
      if (!isWalkInStaff && !user.name?.trim()) return res.status(400).json({ error: 'Your account must have your full name before booking Registrar.' });
      registrarProfile = {
        studentId: isWalkInStaff ? req.body.registrarProfile.studentId.trim() : user.studentId,
        major: req.body.registrarProfile.major.trim(),
        certificateType: req.body.registrarProfile.certificateType,
        paymentStatus: req.body.registrarProfile.paymentStatus,
        documentsStatus: req.body.registrarProfile.documentsStatus,
        phone: req.body.registrarProfile.phone.trim(),
        statusSource: isWalkInStaff ? 'usher-entered' : 'student-reported',
      };
      if (isWalkInStaff) registrarProfile.studentName = req.body.registrarProfile.studentName.trim();
      suggestedRoomCode = registrarProfile.certificateType === 'general' ? 'OOB' : 'OO7';
      appointmentDate = req.body.registrarProfile.appointmentDate;
      timeSlot = req.body.registrarProfile.timeSlot;
      if (!isWalkInStaff && user) await store.update('users', { _id: user._id }, { $set: { phone: registrarProfile.phone } });
      if (isWalkInStaff && req.user.role === 'room-usher' && req.user.roomCode !== suggestedRoomCode) {
        return res.status(403).json({ error: 'This student belongs to the other Registrar room' });
      }
      const slotsResponse = await fetchAppointmentSlotCount(store, service._id, appointmentDate, timeSlot, { staffWalkIn: isWalkInStaff });
      if (!slotsResponse.valid) return res.status(400).json({ error: slotsResponse.error });
      if (isWalkInStaff) {
        const byId = await store.findOne('users', { studentId: registrarProfile.studentId });
        if (byId && byId._id !== user?._id) return res.status(409).json({ error: 'This MIU ID belongs to a registered account. Ask the student to sign in or verify the ID.' });
      }
    }
    const ticket = await engine.joinQueue(io, store, {
      serviceId: req.params.id,
      userId: req.body.registrarProfile?.walkIn === true ? null : req.user.sub,
      walkInName: registrarProfile?.studentName || null,
      walkInStudentId: registrarProfile?.studentId || null,
      priority: service.code === 'REG' ? 'normal' : req.body.priority || 'normal',
      note: req.body.note || '',
      roomCode,
      suggestedRoomCode,
      registrarProfile,
      appointmentDate,
      timeSlot,
    });
    res.status(201).json({ ticket });
  } catch (err) {
    next(err);
  }
});

async function fetchAppointmentSlotCount(store, serviceId, date, time, { staffWalkIn = false } = {}) {
  const selected = parseAppointmentDate(date);
  if (!selected || date !== localDateString()) {
    return { valid: false, error: 'Appointments can only be booked for today' };
  }
  if (!APPOINTMENT_SLOTS.includes(time)) return { valid: false, error: 'Choose a valid appointment time' };
  const now = new Date();
  const settings = await registrarBookingSettings(store);
  if (!staffWalkIn && (!settings.enabled || isClosedDay(selected, settings.closedDays))) return { valid: false, error: 'Online bookings are closed today' };
  if (!staffWalkIn && (now.getHours() < 8 || now.getHours() >= 15)) return { valid: false, error: 'Booking is open from 8:00 AM to 3:00 PM' };
  if (!staffWalkIn && new Date(`${date}T${time}:00`) <= now) return { valid: false, error: 'This appointment time has already passed' };
  if (staffWalkIn && !APPOINTMENT_SLOTS.includes(time)) return { valid: false, error: 'Choose a valid appointment time from 8:00 AM to 3:00 PM' };
  const booked = await store.count('tickets', { serviceId, appointmentDate: date, timeSlot: time, status: { $ne: 'cancelled' } });
  return booked < APPOINTMENT_SLOT_CAPACITY ? { valid: true } : { valid: false, error: 'That appointment time is full. Choose another time.' };
}

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
  const qrData = {
    ticketId: ticket._id,
    code: ticket.code,
    service: ticket.serviceName,
    status: ticket.status,
    position: ticket.position,
  };
  if (ticket.appointmentNumber) {
    qrData.appointmentDate = ticket.appointmentDate;
    qrData.signature = crypto.createHmac('sha256', config.jwtSecret).update(`${qrData.ticketId}|${qrData.code}|${ticket.serviceId}|${ticket.appointmentDate}`).digest('hex');
  } else {
    qrData.verify = `${base}/api/tickets/${ticket._id}/public`;
  }
  const payload = JSON.stringify(qrData);
  try {
    const png = await QRCode.toBuffer(payload, { width: 320, margin: 1 });
    res.setHeader('Content-Type', 'image/png');
    res.send(png);
  } catch (err) {
    res.status(500).json({ error: 'QR generation failed' });
  }
});

module.exports = router;
