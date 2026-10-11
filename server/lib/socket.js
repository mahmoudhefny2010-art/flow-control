// Socket.io real-time layer
const { allowRoles } = require('./auth');

function attachSocket(io, getStore) {
  // rooms: service:<id>, ticket:<id>, employee, admin
  io.on('connection', (socket) => {
    let user = null;
    let authPending = Promise.resolve();

    // Optional authenticated join: client emits 'auth' with JWT
    socket.on('auth', (token) => {
      authPending = (async () => {
      const jwt = require('jsonwebtoken');
      const config = require('../config');
      try {
        const payload = jwt.verify(token, config.jwtSecret);
        const store = await getStore();
        const found = await store.findOne('users', { _id: payload.sub, active: true });
        if (found) {
          user = found;
          socket.join(`user:${user._id}`);
          if (user.role === 'admin') socket.join('admin');
          if (user.role === 'employee') socket.join('employee');
        }
      } catch (err) { user = null; /* anonymous connection stays read-only */ }
      })();
    });

    socket.on('subscribe', async (...rooms) => {
      await authPending;
      rooms.forEach((room) => {
        // Service/ticket rooms are public; admission details require staff auth.
        const roomMatch = room.match(/^room:([a-z0-9-]{10,}):(OOB|OO7)$/i);
        if (/^(service|ticket):[a-z0-9-]{10,}$/i.test(room)
          || (roomMatch && user && ['room-usher', 'registrar-staff', 'admin'].includes(user.role)
            && (user.role === 'admin' || user.roomCode === roomMatch[2]))) socket.join(room);
      });
    });

    socket.on('unsubscribe', (...rooms) => {
      rooms.forEach((room) => socket.leave(room));
    });

    socket.on('ping', (cb) => {
      if (typeof cb === 'function') cb({ pong: Date.now(), user: user ? user.email : 'anon' });
    });

    socket.on('disconnect', () => { /* no-op */ });
  });
}

module.exports = { attachSocket };
