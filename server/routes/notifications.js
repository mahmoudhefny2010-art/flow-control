// Notification routes (in-app + email log)
const express = require('express');
const { createRouter } = require('../lib/asyncRouter');
const { allowRoles } = require('../lib/auth');

const router = createRouter();

// GET /api/notifications - notifications for the logged-in user
router.get('/', allowRoles('student', 'employee', 'outside-usher', 'room-usher', 'registrar-staff', 'admin'), async (req, res) => {
  const store = req.app.get('store');
  const notifications = await store.find(
    'notifications',
    { userId: req.user.sub },
    { sort: { createdAt: -1 }, limit: 50 },
  );
  res.json({ notifications });
});

module.exports = router;
