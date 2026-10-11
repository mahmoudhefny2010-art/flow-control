// Analytics routes
const express = require('express');
const { createRouter } = require('../lib/asyncRouter');
const { allowRoles } = require('../lib/auth');
const analytics = require('../lib/analytics');

const router = createRouter();

const guard = allowRoles('employee', 'admin');

router.get('/overview', guard, async (req, res) => {
  const store = req.app.get('store');
  const days = parseInt(req.query.days, 10) || 1;
  res.json(await analytics.overview(store, { days }));
});

router.get('/heatmap', guard, async (req, res) => {
  const store = req.app.get('store');
  const days = parseInt(req.query.days, 10) || 7;
  res.json(await analytics.heatmap(store, { days }));
});

router.get('/services', guard, async (req, res) => {
  const store = req.app.get('store');
  const days = parseInt(req.query.days, 10) || 7;
  res.json({ services: await analytics.perService(store, { days }) });
});

router.get('/forecast', guard, async (req, res) => {
  const store = req.app.get('store');
  res.json(await analytics.forecast(store, { days: 14 }));
});

router.get('/trends', guard, async (req, res) => {
  const store = req.app.get('store');
  const days = parseInt(req.query.days, 10) || 14;
  res.json({ days: await analytics.trends(store, { days }) });
});

router.get('/feedback', guard, async (req, res) => {
  const store = req.app.get('store');
  const days = parseInt(req.query.days, 10) || 30;
  res.json(await analytics.feedbackStats(store, { days }));
});

module.exports = router;
