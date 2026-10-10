// Admin routes: services CRUD, counters, users, notifications, system
const express = require('express');
const { validate, badRequest } = require('../lib/validate');
const { allowRoles } = require('../lib/auth');
const { id, round1 } = require('../lib/util');
const engine = require('../lib/queueEngine');

const router = express.Router();

// --- Dashboard overview --------------------------------------------------
router.get('/overview', allowRoles('admin'), async (req, res) => {
  const store = req.app.get('store');
  const analytics = require('../lib/analytics');
  const [today, week, services, users, counters, notifications] = await Promise.all([
    analytics.overview(store, { days: 1 }),
    analytics.overview(store, { days: 7 }),
    store.find('services', {}, { sort: { name: 1 } }),
    store.find('users', {}, { sort: { createdAt: -1 }, limit: 50 }),
    store.find('counters', {}, { sort: { name: 1 } }),
    store.find('notifications', {}, { sort: { createdAt: -1 }, limit: 50 }),
  ]);
  res.json({ today, week, services, users, counters, notifications });
});

// --- Services CRUD -------------------------------------------------------
router.post('/services', allowRoles('admin'), async (req, res) => {
  const { valid, errors } = validate(req.body || {}, {
    name: { type: 'string', required: true, max: 80 },
    code: { type: 'string', required: true, max: 10 },
    category: { type: 'string', max: 40 },
    building: { type: 'string', required: true, max: 80 },
    floor: { type: 'string', max: 20 },
    room: { type: 'string', max: 40 },
    description: { type: 'string', max: 500 },
    avgServiceMinutes: { type: 'number', min: 1, max: 120 },
    priorityEnabled: { type: 'enum', enum: [true, false] },
    map: { type: 'object' },
  });
  if (!valid) return badRequest(res, errors);
  const store = req.app.get('store');
  const dup = await store.findOne('services', { code: req.body.code.toUpperCase() });
  if (dup) return res.status(409).json({ error: 'Service code already in use' });
  const service = {
    _id: id(),
    name: req.body.name.trim(),
    code: req.body.code.trim().toUpperCase(),
    category: req.body.category || 'General',
    building: req.body.building,
    floor: req.body.floor || '',
    room: req.body.room || '',
    description: req.body.description || '',
    avgServiceMinutes: req.body.avgServiceMinutes || 5,
    priorityEnabled: req.body.priorityEnabled !== false,
    active: true,
    map: req.body.map || { x: 500, y: 300 },
    createdAt: new Date().toISOString(),
  };
  await store.insert('services', service);
  const io = req.app.get('io');
  await engine.broadcastQueue(io, store, service._id);
  res.status(201).json({ service });
});

router.put('/services/:id', allowRoles('admin'), async (req, res) => {
  const { valid, errors } = validate(req.body || {}, {
    name: { type: 'string', max: 80 },
    code: { type: 'string', max: 10 },
    category: { type: 'string', max: 40 },
    building: { type: 'string', max: 80 },
    floor: { type: 'string', max: 20 },
    room: { type: 'string', max: 40 },
    description: { type: 'string', max: 500 },
    avgServiceMinutes: { type: 'number', min: 1, max: 120 },
    priorityEnabled: { type: 'enum', enum: [true, false] },
    active: { type: 'enum', enum: [true, false] },
    map: { type: 'object' },
  });
  if (!valid) return badRequest(res, errors);
  const store = req.app.get('store');
  const service = await store.findOne('services', { _id: req.params.id });
  if (!service) return res.status(404).json({ error: 'Service not found' });
  const update = {};
  for (const key of ['name', 'category', 'building', 'floor', 'room', 'description', 'avgServiceMinutes', 'priorityEnabled', 'active', 'map']) {
    if (req.body[key] !== undefined) update[key] = req.body[key];
  }
  if (req.body.code) update.code = req.body.code.toUpperCase();
  await store.update('services', { _id: service._id }, { $set: update });
  const io = req.app.get('io');
  await engine.broadcastQueue(io, store, service._id);
  res.json({ service: await store.findOne('services', { _id: service._id }) });
});

router.delete('/services/:id', allowRoles('admin'), async (req, res) => {
  const store = req.app.get('store');
  const service = await store.findOne('services', { _id: req.params.id });
  if (!service) return res.status(404).json({ error: 'Service not found' });
  await store.delete('counters', { serviceId: service._id });
  await store.delete('services', { _id: service._id });
  res.json({ ok: true });
});

// --- Counters ------------------------------------------------------------
router.post('/counters', allowRoles('admin'), async (req, res) => {
  const { valid, errors } = validate(req.body || {}, {
    name: { type: 'string', required: true, max: 60 },
    serviceId: { type: 'string', required: true },
    employeeId: { type: 'string' },
  });
  if (!valid) return badRequest(res, errors);
  const store = req.app.get('store');
  const counter = {
    _id: id(),
    name: req.body.name.trim(),
    serviceId: req.body.serviceId,
    employeeId: req.body.employeeId || null,
    status: 'open',
    createdAt: new Date().toISOString(),
  };
  await store.insert('counters', counter);
  res.status(201).json({ counter });
});

router.put('/counters/:id', allowRoles('admin'), async (req, res) => {
  const { valid, errors } = validate(req.body || {}, {
    name: { type: 'string', max: 60 },
    status: { type: 'enum', enum: ['open', 'closed'] },
    employeeId: { type: 'string' },
  });
  if (!valid) return badRequest(res, errors);
  const store = req.app.get('store');
  const counter = await store.findOne('counters', { _id: req.params.id });
  if (!counter) return res.status(404).json({ error: 'Counter not found' });
  const update = {};
  for (const key of ['name', 'status', 'employeeId']) {
    if (req.body[key] !== undefined) update[key] = req.body[key];
  }
  await store.update('counters', { _id: counter._id }, { $set: update });
  res.json({ counter: await store.findOne('counters', { _id: counter._id }) });
});

// --- Users ---------------------------------------------------------------
router.put('/users/:id', allowRoles('admin'), async (req, res) => {
  const { valid, errors } = validate(req.body || {}, {
    name: { type: 'string', max: 80 },
    role: { type: 'enum', enum: ['student', 'employee', 'admin'] },
    active: { type: 'enum', enum: [true, false] },
    studentId: { type: 'string', max: 30 },
    phone: { type: 'string', max: 20 },
  });
  if (!valid) return badRequest(res, errors);
  const store = req.app.get('store');
  const user = await store.findOne('users', { _id: req.params.id });
  if (!user) return res.status(404).json({ error: 'User not found' });
  const update = {};
  for (const key of ['name', 'role', 'active', 'studentId', 'phone']) {
    if (req.body[key] !== undefined) update[key] = req.body[key];
  }
  await store.update('users', { _id: user._id }, { $set: update });
  res.json({ user: await store.findOne('users', { _id: user._id }) });
});

// POST /api/admin/users - create staff account (employee/admin)
router.post('/users', allowRoles('admin'), async (req, res) => {
  const { validate: v, badRequest: br } = require('../lib/validate');
  const { valid, errors } = v(req.body || {}, {
    name: { type: 'string', required: true, max: 80 },
    email: { type: 'email', required: true, max: 120 },
    password: { type: 'string', required: true, min: 8, max: 128 },
    role: { type: 'enum', enum: ['employee', 'admin'] },
  });
  if (!valid) return br(res, errors);
  const bcrypt = require('bcryptjs');
  const store = req.app.get('store');
  const exists = await store.findOne('users', { email: req.body.email.toLowerCase() });
  if (exists) return res.status(409).json({ error: 'Email already in use' });
  const user = {
    _id: id(),
    name: req.body.name.trim(),
    email: req.body.email.toLowerCase().trim(),
    passwordHash: await bcrypt.hash(req.body.password, 10),
    role: req.body.role,
    preferences: { emailNotifications: true },
    active: true,
    createdAt: new Date().toISOString(),
  };
  await store.insert('users', user);
  res.status(201).json({ user: { _id: user._id, name: user.name, email: user.email, role: user.role } });
});

// --- Notifications log ----------------------------------------------------
router.get('/notifications', allowRoles('admin'), async (req, res) => {
  const store = req.app.get('store');
  const notifications = await store.find('notifications', {}, { sort: { createdAt: -1 }, limit: 100 });
  res.json({ notifications });
});

// --- Feedback management --------------------------------------------------
router.get('/feedback', allowRoles('admin'), async (req, res) => {
  const store = req.app.get('store');
  const analytics = require('../lib/analytics');
  const stats = await analytics.feedbackStats(store, { days: 30 });
  res.json(stats);
});

module.exports = router;
