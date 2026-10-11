require('dotenv').config({ override: false });

const path = require('path');

if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET must be set when NODE_ENV=production');
}

const parsedPort = process.env.PORT ? Number(process.env.PORT) : 3000;
if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
  throw new Error('PORT must be a valid TCP port from 1 to 65535');
}

const config = {
  port: parsedPort,
  nodeEnv: process.env.NODE_ENV || 'development',
  jwtSecret: process.env.JWT_SECRET || 'miu-queueflow-dev-secret-change-me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '12h',
  mongoUri: process.env.MONGODB_URI || '',
  // Path of the JSON file used by the dev storage engine
  dataFile: process.env.DATA_FILE || path.join(__dirname, '..', 'data', 'db.json'),
  // Base URL of the EXISTING queue system we integrate with.
  // When empty, the built-in mock legacy API (server/lib/legacyApi.js) is used.
  legacyApiBase: process.env.LEGACY_API_BASE || '',
  legacyApiKey: process.env.LEGACY_API_KEY || 'mock-key',
  // Email (SMTP). When SMTP_HOST is empty, a dev mailer logs to console + DB.
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: parseInt(process.env.SMTP_PORT, 10) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.MAIL_FROM || 'MIU QueueFlow <no-reply@miu.edu.eg>',
  },
  // Queue tuning
  priorityBoostMinutes: parseInt(process.env.PRIORITY_BOOST_MIN, 10) || 45,
  callTimeoutMinutes: parseInt(process.env.CALL_TIMEOUT_MIN, 10) || 5,
  // Alert when waiting count for a service exceeds this
  queueAlertThreshold: parseInt(process.env.QUEUE_ALERT_THRESHOLD, 10) || 15,
  // Demo seed accounts (used by scripts/seed.js)
  seed: {
    adminEmail: 'admin@miu.edu.eg',
    adminPass: 'Admin@1234',
    employeeEmail: 'officer@miu.edu.eg',
    employeePass: 'Officer@1234',
    studentEmail: 'student@miu.edu.eg',
    studentPass: 'Student@1234',
  },
};

module.exports = config;
