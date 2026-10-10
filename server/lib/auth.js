// JWT + password helpers
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const config = require('../config');

const SALT_ROUNDS = 10;

async function hashPassword(plain) {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

async function verifyPassword(plain, hash) {
  if (!hash) return false;
  return bcrypt.compare(plain, hash);
}

function signToken(user) {
  const payload = {
    sub: user._id,
    email: user.email,
    role: user.role,
  };
  return jwt.sign(payload, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, config.jwtSecret);
  } catch (err) {
    return null;
  }
}

// Role guard: verifies the JWT, loads the user onto req.user,
// then checks the role. Accepts any of the listed roles.
function allowRoles(...roles) {
  return async (req, res, next) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const payload = verifyToken(token);
    if (!payload) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    let userDoc = null;
    try {
      const store = req.app.get('store');
      userDoc = await store.findOne('users', { _id: payload.sub, active: true });
    } catch (err) {
      return res.status(500).json({ error: 'Internal server error' });
    }
    if (!userDoc) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    req.user = {
      sub: userDoc._id,
      email: userDoc.email,
      role: userDoc.role,
      name: userDoc.name,
    };
    if (roles.length && !roles.includes(userDoc.role)) {
      return res.status(403).json({ error: `Requires role: ${roles.join(' or ')}` });
    }
    next();
  };
}

module.exports = { hashPassword, verifyPassword, signToken, verifyToken, allowRoles };
