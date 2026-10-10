// Auth routes: register / login / me / password change
const express = require('express');
const rateLimit = require('express-rate-limit');
const { validate, badRequest } = require('../lib/validate');
const { hashPassword, verifyPassword, signToken, verifyToken, allowRoles } = require('../lib/auth');
const { id } = require('../lib/util');

const router = express.Router();

const authLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts, try again later' },
});

function publicUser(u) {
  return {
    _id: u._id, name: u.name, email: u.email, role: u.role,
    studentId: u.studentId || '', phone: u.phone || '',
    preferences: u.preferences || { emailNotifications: true },
    active: u.active !== false,
    createdAt: u.createdAt,
  };
}

// POST /api/auth/register  (self-registration as student)
router.post('/register', authLimiter, async (req, res) => {
  const { valid, errors } = validate(req.body, {
    name: { type: 'string', required: true, min: 2, max: 80 },
    email: { type: 'email', required: true, max: 120 },
    password: { type: 'string', required: true, min: 8, max: 128 },
    studentId: { type: 'string', max: 30 },
    phone: { type: 'string', max: 20 },
  });
  if (!valid) return badRequest(res, errors);

  const store = req.app.get('store');
  const exists = await store.findOne('users', { email: req.body.email.toLowerCase() });
  if (exists) return res.status(409).json({ error: 'An account with this email already exists' });

  const user = {
    _id: id(),
    name: req.body.name.trim(),
    email: req.body.email.toLowerCase().trim(),
    passwordHash: await hashPassword(req.body.password),
    role: 'student',
    studentId: req.body.studentId || '',
    phone: req.body.phone || '',
    preferences: { emailNotifications: true },
    active: true,
    createdAt: new Date().toISOString(),
  };
  await store.insert('users', user);

  const token = signToken(user);
  res.status(201).json({ token, user: publicUser(user) });
});

// POST /api/auth/login
router.post('/login', authLimiter, async (req, res) => {
  const { valid, errors } = validate(req.body, {
    email: { type: 'email', required: true },
    password: { type: 'string', required: true },
  });
  if (!valid) return badRequest(res, errors);

  const store = req.app.get('store');
  const user = await store.findOne('users', { email: req.body.email.toLowerCase() });
  if (!user || user.active === false) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const ok = await verifyPassword(req.body.password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

  const token = signToken(user);
  res.json({ token, user: publicUser(user) });
});

// GET /api/auth/me
router.get('/me', async (req, res) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const payload = verifyToken(token);
  if (!payload) return res.status(401).json({ error: 'Invalid or expired token' });
  const store = req.app.get('store');
  const user = await store.findOne('users', { _id: payload.sub, active: true });
  if (!user) return res.status(401).json({ error: 'User not found' });
  res.json({ user: publicUser(user) });
});

// POST /api/auth/change-password
router.post('/change-password', allowRoles('student', 'employee', 'admin'), async (req, res) => {
  const { valid, errors } = validate(req.body, {
    currentPassword: { type: 'string', required: true },
    newPassword: { type: 'string', required: true, min: 8, max: 128 },
  });
  if (!valid) return badRequest(res, errors);
  const store = req.app.get('store');
  const user = await store.findOne('users', { _id: req.user.sub });
  const ok = await verifyPassword(req.body.currentPassword, user.passwordHash);
  if (!ok) return res.status(400).json({ error: 'Current password is incorrect' });
  await store.update('users', { _id: user._id }, {
    $set: { passwordHash: await hashPassword(req.body.newPassword) },
  });
  res.json({ ok: true });
});

module.exports = router;
