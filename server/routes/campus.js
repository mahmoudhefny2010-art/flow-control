// Campus map routes
const express = require('express');
const { allowRoles } = require('../lib/auth');
const campus = require('../lib/campus');

const router = express.Router();

// GET /api/campus/map - buildings, paths and live service markers
router.get('/map', async (req, res) => {
  const store = req.app.get('store');
  const services = await store.find('services', { active: true });
  const markers = [];
  for (const s of services) {
    const waiting = await store.count('tickets', { serviceId: s._id, status: 'waiting' });
    const called = await store.count('tickets', { serviceId: s._id, status: 'called' });
    const level = waiting === 0 ? 'low' : waiting < 8 ? 'medium' : 'high';
    markers.push({
      serviceId: s._id,
      name: s.name,
      code: s.code,
      building: s.building,
      x: s.map ? s.map.x : 500,
      y: s.map ? s.map.y : 300,
      waiting,
      called,
      level,
    });
  }
  res.json({ buildings: campus.buildings, paths: campus.paths, markers });
});

// GET /api/campus/route?from=gate&to=library
router.get('/route', async (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) return res.status(400).json({ error: 'from and to are required' });
  const route = campus.route(from, to);
  if (!route) return res.status(404).json({ error: 'No route found' });
  // Attach services at the destination
  const store = req.app.get('store');
  const dest = campus.buildings.find((b) => b.id === to);
  const services = await store.find('services', { active: true, building: dest.name });
  res.json({ ...route, destination: dest, servicesAtDestination: services });
});

// GET /api/campus/buildings
router.get('/buildings', (req, res) => {
  res.json({ buildings: campus.buildings, paths: campus.paths });
});

module.exports = router;
