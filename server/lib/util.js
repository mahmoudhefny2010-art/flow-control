// Small utilities shared across the server
const crypto = require('crypto');

const id = () => crypto.randomUUID();

const pad = (n, len = 4) => String(n).padStart(len, '0');

function startOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

const minutesBetween = (a, b) => Math.max(0, Math.round((new Date(b) - new Date(a)) / 60000));

const round1 = (n) => Math.round(n * 10) / 10;

// Deterministic pseudo-random generator for stable seed data
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

module.exports = { id, pad, startOfDay, endOfDay, minutesBetween, round1, mulberry32 };
