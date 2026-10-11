// Smart analytics: KPIs, hourly heatmap, per-service stats, demand forecast.
const { startOfDay, endOfDay, minutesBetween, round1 } = require('./util');

function dayRange(daysBack = 0) {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - daysBack);
  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);
  return { start: start.toISOString(), end: end.toISOString() };
}

// --- KPIs ----------------------------------------------------------------

async function overview(store, { days = 1 } = {}) {
  const range = dayRange(days - 1);
  const tickets = await store.find('tickets', {
    createdAt: { $gte: range.start, $lte: range.end },
  });
  const served = tickets.filter((t) => t.status === 'served');
  const waits = served.filter((t) => t.waitMinutes != null).map((t) => t.waitMinutes);
  const services = served.filter((t) => t.serviceMinutes != null).map((t) => t.serviceMinutes);
  const avgWait = waits.length ? round1(waits.reduce((a, b) => a + b, 0) / waits.length) : 0;
  const avgService = services.length ? round1(services.reduce((a, b) => a + b, 0) / services.length) : 0;
  const p95Wait = percentile(waits, 0.95);

  // Feedback / CSAT
  const feedback = await store.find('feedback', { createdAt: { $gte: range.start, $lte: range.end } });
  const ratings = feedback.map((f) => f.rating);
  const csat = ratings.length ? round1(ratings.reduce((a, b) => a + b, 0) / ratings.length) : 0;

  // Live queue
  const servicesList = await store.find('services', { active: true });
  const live = [];
  for (const s of servicesList) {
    const waiting = await store.count('tickets', { serviceId: s._id, status: 'waiting' });
    const called = await store.count('tickets', { serviceId: s._id, status: 'called' });
    live.push({ serviceId: s._id, name: s.name, building: s.building, waiting, called });
  }

  return {
    period: `last ${days} day(s)`,
    totalTickets: tickets.length,
    served: served.length,
    waitingNow: live.reduce((a, b) => a + b.waiting, 0),
    avgWaitMinutes: avgWait,
    avgWaitSamples: waits.length,
    avgServiceMinutes: avgService,
    p95WaitMinutes: p95Wait,
    csat,
    feedbackCount: feedback.length,
    responseRate: served.length ? round1((feedback.length / served.length) * 100) : 0,
    liveQueues: live,
  };
}

// --- Hourly heatmap (arrivals + served) ----------------------------------

async function heatmap(store, { days = 7 } = {}) {
  const range = dayRange(days - 1);
  const tickets = await store.find('tickets', {
    createdAt: { $gte: range.start, $lte: range.end },
  });
  // buckets: day-of-week (0=Sun..6) x hour (0..23)
  const arrivals = Array.from({ length: 7 }, () => Array(24).fill(0));
  const servedAt = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const t of tickets) {
    const d = new Date(t.createdAt);
    arrivals[d.getDay()][d.getHours()] += 1;
    if (t.servedAt) {
      const sd = new Date(t.servedAt);
      servedAt[sd.getDay()][sd.getHours()] += 1;
    }
  }
  return { arrivals, served: servedAt, days };
}

// --- Per-service stats ---------------------------------------------------

async function perService(store, { days = 7 } = {}) {
  const range = dayRange(days - 1);
  const [services, tickets, feedback] = await Promise.all([
    store.find('services', {}),
    store.find('tickets', { createdAt: { $gte: range.start, $lte: range.end } }),
    store.find('feedback', { createdAt: { $gte: range.start, $lte: range.end } }),
  ]);
  return services.map((s) => {
    const mine = tickets.filter((t) => t.serviceId === s._id);
    const served = mine.filter((t) => t.status === 'served');
    const waits = served.filter((t) => t.waitMinutes != null).map((t) => t.waitMinutes);
    const svc = served.filter((t) => t.serviceMinutes != null).map((t) => t.serviceMinutes);
    const fb = feedback.filter((f) => f.serviceId === s._id);
    const ratings = fb.map((f) => f.rating);
    const waitingNow = mine.filter((t) => t.status === 'waiting').length;
    return {
      serviceId: s._id,
      name: s.name,
      code: s.code,
      building: s.building,
      total: mine.length,
      served: served.length,
      waitingNow,
      avgWaitMinutes: waits.length ? round1(waits.reduce((a, b) => a + b, 0) / waits.length) : 0,
      avgWaitSamples: waits.length,
      avgServiceMinutes: svc.length ? round1(svc.reduce((a, b) => a + b, 0) / svc.length) : 0,
      csat: ratings.length ? round1(ratings.reduce((a, b) => a + b, 0) / ratings.length) : 0,
      priorityShare: mine.length ? round1((mine.filter((t) => t.priority === 'high').length / mine.length) * 100) : 0,
    };
  });
}

// --- Demand forecast (next 2 hours) --------------------------------------

async function forecast(store, { days = 14 } = {}) {
  const range = dayRange(days - 1);
  const tickets = await store.find('tickets', {
    createdAt: { $gte: range.start, $lte: range.end },
  });
  const now = new Date();
  const buckets = {}; // hour -> array of counts per day
  for (const t of tickets) {
    const d = new Date(t.createdAt);
    const key = `${d.getDay()}:${d.getHours()}`;
    buckets[key] = (buckets[key] || 0) + 1;
  }
  const out = [];
  for (let h = 0; h < 2; h += 1) {
    const t = new Date(now.getTime() + h * 3600000);
    const key = `${t.getDay()}:${t.getHours()}`;
    const count = buckets[key] || 0;
    out.push({
      hour: t.getHours(),
      label: `${t.getHours()}:00`,
      expected: Math.round(count / days),
    });
  }
  // Peak hour today so far
  const hourly = Array(24).fill(0);
  for (const t of tickets) hourly[new Date(t.createdAt).getHours()] += 1;
  const peakHour = hourly.indexOf(Math.max(...hourly));
  return { next2Hours: out, peakHour, historyDays: days };
}

// --- Trends (daily totals for the last N days) ----------------------------

async function trends(store, { days = 14 } = {}) {
  const out = [];
  for (let d = days - 1; d >= 0; d -= 1) {
    const day = new Date();
    day.setDate(day.getDate() - d);
    const start = startOfDay(day).toISOString();
    const end = endOfDay(day).toISOString();
    const tickets = await store.find('tickets', { createdAt: { $gte: start, $lte: end } });
    const served = tickets.filter((t) => t.status === 'served');
    const waits = served.filter((t) => t.waitMinutes != null).map((t) => t.waitMinutes);
    out.push({
      date: day.toISOString().slice(0, 10),
      weekday: day.toLocaleDateString('en-US', { weekday: 'short' }),
      total: tickets.length,
      served: served.length,
      avgWait: waits.length ? round1(waits.reduce((a, b) => a + b, 0) / waits.length) : 0,
    });
  }
  return out;
}

// --- Feedback analytics ---------------------------------------------------

async function feedbackStats(store, { days = 30 } = {}) {
  const range = dayRange(days - 1);
  const feedback = await store.find('feedback', { createdAt: { $gte: range.start, $lte: range.end } });
  const dist = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
  for (const f of feedback) dist[f.rating] = (dist[f.rating] || 0) + 1;
  const ratings = feedback.map((f) => f.rating);
  const avg = ratings.length ? round1(ratings.reduce((a, b) => a + b, 0) / ratings.length) : 0;
  // latest comments (non-empty), newest first
  const comments = feedback
    .filter((f) => f.comment && f.comment.trim())
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 50)
    .map((f) => ({ ...f }));
  return {
    average: avg,
    count: feedback.length,
    distribution: dist,
    comments,
  };
}

function percentile(arr, p) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1);
  return sorted[idx];
}

module.exports = { overview, heatmap, perService, forecast, trends, feedbackStats };
