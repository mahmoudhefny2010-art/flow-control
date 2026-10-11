// Seed script: demo users, services, counters, 14 days of history, live queues.
// Usage: npm run seed
require('dotenv').config();
const path = require('path');
const config = require('../server/config');
const { createStore } = require('../server/lib/storage');
const { JsonStore, COLLECTIONS } = require('../server/lib/storage/jsonStore');
const { id, pad, mulberry32 } = require('../server/lib/util');

const rng = mulberry32(20260110);
const rand = (min, max) => Math.round(min + rng() * (max - min));
const pick = (arr) => arr[Math.floor(rng() * arr.length)];

const SERVICES = [
  { name: 'Advising Office', code: 'ADV', category: 'Academic', building: 'MIU Campus', floor: '', room: '', description: 'Academic advising and student guidance', avgServiceMinutes: 10, priorityEnabled: false, map: { x: 500, y: 300 } },
  { name: 'Registrar Office', code: 'REG', category: 'Academic', building: 'Registration Hall', floor: 'Ground', room: 'OOB / OO7', description: 'Newcomer admission and registration intake', avgServiceMinutes: 6, priorityEnabled: false, map: { x: 330, y: 400 } },
];

const FIRST = ['Ahmed', 'Mariam', 'Youssef', 'Fatma', 'Karim', 'Nour', 'Omar', 'Hana', 'Tarek', 'Salma', 'Ramy', 'Dina', 'Ali', 'Rania', 'Mostafa', 'Aya', 'Hassan', 'Laila', 'Sami', 'Menna'];
const LAST = ['Hassan', 'Ali', 'Mohamed', 'Ibrahim', 'Said', 'Mahmoud', 'Farag', 'Nasser', 'Khalil', 'Zaki', 'Awad', 'Saleh', 'Gaber', 'Fouad', 'Reda', 'Atef', 'Bakry', 'Sobhy', 'Tawfik', 'Aziz'];

async function main() {
  const store = await createStore();
  await store.drop();
  console.log('[seed] cleared database');

  // --- Users -----------------------------------------------------------
  const { hashPassword } = require('../server/lib/auth');
  const users = [];
  const admin = {
    _id: id(), name: 'System Administrator', email: config.seed.adminEmail,
    passwordHash: await hashPassword(config.seed.adminPass),
    role: 'admin', active: true, preferences: { emailNotifications: true },
    createdAt: new Date(Date.now() - 30 * 86400000).toISOString(),
  };
  users.push(admin);

  const employees = [];
  const employeeNames = ['Mona Abdel Fattah', 'Khaled El-Sayed', 'Rania Mostafa'];
  for (let i = 0; i < employeeNames.length; i += 1) {
    const e = {
      _id: id(), name: employeeNames[i], email: i === 0 ? config.seed.employeeEmail : `officer${i + 1}@miu.edu.eg`,
      passwordHash: await hashPassword(config.seed.employeePass),
      role: 'employee', active: true, preferences: { emailNotifications: true },
      createdAt: new Date(Date.now() - 25 * 86400000).toISOString(),
    };
    employees.push(e);
    users.push(e);
  }

  const intakeAccounts = [
    { name: 'Campus Entrance Usher', email: 'outside@miu.edu.eg', role: 'outside-usher' },
    { name: 'OOB Room Usher', email: 'room.oob@miu.edu.eg', role: 'room-usher', roomCode: 'OOB' },
    { name: 'OO7 Room Usher', email: 'room.oo7@miu.edu.eg', role: 'room-usher', roomCode: 'OO7' },
    { name: 'OOB Registrar Staff', email: 'registrar.oob@miu.edu.eg', role: 'registrar-staff', roomCode: 'OOB' },
    { name: 'OO7 Registrar Staff', email: 'registrar.oo7@miu.edu.eg', role: 'registrar-staff', roomCode: 'OO7' },
  ];
  for (const account of intakeAccounts) users.push({
    _id: id(), ...account, passwordHash: await hashPassword(config.seed.employeePass),
    active: true, preferences: { emailNotifications: true }, createdAt: new Date().toISOString(),
  });

  const student = {
    _id: id(), name: 'Demo Student', email: config.seed.studentEmail,
    passwordHash: await hashPassword(config.seed.studentPass),
    role: 'student', studentId: '2024/06700', phone: '01001234567',
    active: true, preferences: { emailNotifications: true },
    createdAt: new Date(Date.now() - 20 * 86400000).toISOString(),
  };
  users.push(student);

  // bulk historical students
  for (let i = 0; i < 60; i += 1) {
    users.push({
      _id: id(),
      name: `${pick(FIRST)} ${pick(LAST)}`,
      email: `student${i + 1}@miu.edu.eg`,
      passwordHash: await hashPassword('Student@1234'),
      role: 'student',
      studentId: `202${rand(3, 6)}/${pad(rand(1, 99999), 5)}`,
      active: true,
      preferences: { emailNotifications: rng() > 0.3 },
      createdAt: new Date(Date.now() - rand(30, 300) * 86400000).toISOString(),
    });
  }
  await store.insertMany('users', users);
  console.log(`[seed] ${users.length} users`);

  // --- Services ----------------------------------------------------------
  const services = SERVICES.map((s) => ({
    _id: id(), ...s, active: true, createdAt: new Date().toISOString(),
  }));
  await store.insertMany('services', services);
  console.log(`[seed] ${services.length} services`);

  // --- Counters ------------------------------------------------------------
  const counters = [];
  for (const s of services) {
    const n = rand(2, 3);
    for (let i = 0; i < n; i += 1) {
      counters.push({
        _id: id(),
        name: `${s.code} Counter ${i + 1}`,
        serviceId: s._id,
        ...(s.code === 'REG' ? { roomCode: i === 0 ? 'OOB' : 'OO7' } : {}),
        employeeId: employees[(services.indexOf(s) + i) % employees.length]._id,
        status: 'open',
        createdAt: new Date().toISOString(),
      });
    }
  }
  await store.insertMany('counters', counters);
  console.log(`[seed] ${counters.length} counters`);

  // --- Historical tickets (14 days) ----------------------------------------
  const students = users.filter((u) => u.role === 'student');
  const today = new Date();
  let seqByService = {};
  const tickets = [];
  const feedback = [];

  for (let day = 14; day >= 1; day -= 1) {
    const date = new Date(today);
    date.setDate(date.getDate() - day);
    const isWeekend = date.getDay() === 5 || date.getDay() === 6; // Fri/Sat
    for (const s of services) {
      const base = isWeekend ? rand(8, 20) : rand(25, 60);
      for (let i = 0; i < base; i += 1) {
        // arrival hours: peak 9-13
        const hour = pick([9, 10, 10, 11, 11, 12, 12, 13, 13, 14, 15, 16, 17, 9, 8]);
        const minute = rand(0, 59);
        const created = new Date(date);
        created.setHours(hour, minute, rand(0, 59), 0);
        if (created > new Date()) continue;

        seqByService[s._id] = (seqByService[s._id] || 0) + 1;
        const studentUser = pick(students);
        const roll = rng();
        const status = roll < 0.88 ? 'served' : roll < 0.94 ? 'cancelled' : 'no-show';
        const wait = rand(3, 42);
        const svc = Math.max(2, Math.round(s.avgServiceMinutes + (rng() * 4 - 2)));
        const calledAt = new Date(created.getTime() + wait * 60000);
        const ticket = {
          _id: id(),
          code: `${s.code}-${pad(seqByService[s._id], 3)}`,
          serviceId: s._id,
          serviceName: s.name,
          building: s.building,
          userId: studentUser._id,
          userName: studentUser.name,
          userEmail: studentUser.email,
          priority: rng() < 0.15 ? 'high' : 'normal',
          note: '',
          status,
          position: rand(1, 20),
          channel: rng() < 0.85 ? 'web' : 'legacy',
          createdAt: created.toISOString(),
          updatedAt: calledAt.toISOString(),
          waitMinutes: wait,
        };
        if (status === 'served') {
          ticket.calledAt = calledAt.toISOString();
          ticket.servedAt = new Date(calledAt.getTime() + svc * 60000).toISOString();
          ticket.completedAt = ticket.servedAt;
          ticket.serviceMinutes = svc;
          ticket.counterId = counters.find((c) => c.serviceId === s._id)._id;
          ticket.counterName = `${s.code} Counter 1`;
        }
        tickets.push(ticket);

        // feedback on ~45% of served tickets
        if (status === 'served' && rng() < 0.45) {
          const rating = pick([5, 5, 5, 4, 4, 4, 3, 2, 1]);
          const comments = {
            5: ['Excellent and fast service, thank you!', 'Very helpful staff.', 'Great experience overall.'],
            4: ['Good service, slight wait.', 'Staff was professional.', 'Fine, but the queue moved slowly.'],
            3: ['Average, expected faster.', 'OK but the system crashed once.'],
            2: ['Long wait, understaffed.', 'Confusing process.'],
            1: ['Very poor experience.', 'Waited over an hour.'],
          };
          feedback.push({
            _id: id(),
            ticketId: ticket._id,
            serviceId: s._id,
            serviceName: s.name,
            userId: studentUser._id,
            userName: studentUser.name,
            rating,
            comment: pick(comments[rating]),
            createdAt: new Date(new Date(ticket.servedAt).getTime() + rand(5, 120) * 60000).toISOString(),
          });
        }
      }
    }
  }
  await store.insertMany('tickets', tickets);
  await store.insertMany('feedback', feedback);
  console.log(`[seed] ${tickets.length} historical tickets, ${feedback.length} feedback records`);

  // --- Live waiting tickets (right now) -----------------------------------
  let liveCount = 0;
  for (const s of services) {
    const n = rand(2, 6);
    seqByService[s._id] = (seqByService[s._id] || 0);
    for (let i = 0; i < n; i += 1) {
      seqByService[s._id] += 1;
      const created = new Date(Date.now() - rand(2, 25) * 60000);
      const studentUser = pick(students);
      const ticket = {
        _id: id(),
        code: `${s.code}-${pad(seqByService[s._id], 3)}`,
        serviceId: s._id,
        serviceName: s.name,
        building: s.building,
        userId: studentUser._id,
        userName: studentUser.name,
        userEmail: studentUser.email,
        priority: rng() < 0.2 ? 'high' : 'normal',
        note: '',
        status: 'waiting',
        position: 0,
        channel: 'web',
        createdAt: created.toISOString(),
        updatedAt: created.toISOString(),
      };
      await store.insert('tickets', ticket);
      liveCount += 1;
    }
    // one currently-called ticket per service
    seqByService[s._id] += 1;
    const calledAt = new Date(Date.now() - rand(1, 4) * 60000);
    await store.insert('tickets', {
      _id: id(),
      code: `${s.code}-${pad(seqByService[s._id], 3)}`,
      serviceId: s._id,
      serviceName: s.name,
      building: s.building,
      userId: pick(students)._id,
      userName: pick(FIRST) + ' ' + pick(LAST),
      userEmail: '',
      priority: 'normal',
      note: '',
      status: 'called',
      position: 0,
      channel: 'web',
      calledAt: calledAt.toISOString(),
      createdAt: new Date(calledAt.getTime() - rand(10, 30) * 60000).toISOString(),
      updatedAt: calledAt.toISOString(),
      waitMinutes: rand(5, 25),
      counterId: counters.find((c) => c.serviceId === s._id)._id,
      counterName: `${s.code} Counter 1`,
    });
  }

  // recompute positions for live tickets
  const { recomputePositions } = require('../server/lib/queueEngine');
  for (const s of services) {
    await recomputePositions(store, s._id);
  }
  console.log(`[seed] ${liveCount} live waiting tickets`);

  // --- Legacy mock gets some tickets too -----------------------------------
  // (legacy state lives in-process; pre-populate via its HTTP API after boot,
  //  or just let operators create tickets through the integration panel.)

  console.log('[seed] done.');
  console.log(`\nDemo accounts:
  Admin:    ${config.seed.adminEmail} / ${config.seed.adminPass}
  Employee: ${config.seed.employeeEmail} / ${config.seed.employeePass}
  Student:  ${config.seed.studentEmail} / ${config.seed.studentPass}\n`);

  // Ensure all debounced writes hit disk before exiting
  if (typeof store.flush === 'function') store.flush();
  if (store.close) await store.close();
  process.exit(0);
}

main().catch((err) => {
  console.error('[seed] failed:', err);
  process.exit(1);
});
