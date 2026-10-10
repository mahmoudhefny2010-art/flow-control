# MIU QueueFlow — Smart Queue Management Platform

A complete smart queue management platform for **Misr International University**.
Integrates with the university's *existing* queue system via REST APIs (mock included
for development) — it does **not** replace anything.

**Live:** http://localhost:3000

---

## ✨ Features

| Area | What you get |
|---|---|
| **User Portal** | Browse services with live wait times, book/cancel virtual tickets, live position tracking, QR tickets, notification center |
| **Virtual Queue Booking** | One-tap booking, daily ticket codes (`REG-042`), ETA estimation, duplicate-ticket guard |
| **Priority Queue** | Fair priority lanes (faculty/staff/accessibility) — priority tickets jump ahead without starving normal tickets |
| **Employee Dashboard** | Counter management (open/close), call-next, serve, recall, no-show, auto no-show timeout, per-employee stats |
| **Admin Dashboard** | KPIs, service CRUD, counter management, user management, notification/email log, threshold alerts |
| **Live Campus Map** | Interactive SVG map of MIU campus, live occupancy markers (green/amber/red), walking routes (Dijkstra), services per building |
| **Smart Analytics** | KPIs, 7×24 arrival heatmap, per-service performance, 2-hour demand forecast, 14-day trends, CSAT & feedback distribution |
| **Feedback System** | 1–5 star ratings + comments after service, duplicate protection, admin insights |
| **Auth & Security** | JWT (HS256) with bcrypt password hashing, role-based access (student / employee / admin), rate-limited auth endpoints, helmet headers |
| **Email Notifications** | Booking confirmation, "your turn" alert, service completion — real SMTP when configured, logged to console + admin feed in dev |
| **Legacy Integration** | REST client to the existing queue system: health check, queue sync, ticket import, booking via legacy endpoint |
| **Realtime** | Socket.io: live queue positions, called/served events, threshold alerts, notification toasts |

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Browser (vanilla ES-modules SPA, no build step)                │
│  public/index.html + js/views/*  ·  hash router  ·  socket.io   │
└───────────────────────────────┬─────────────────────────────────┘
                                │ HTTPS / JSON + Socket.io
┌───────────────────────────────▼─────────────────────────────────┐
│  Express 4  (server/index.js)  ·  port 3000                      │
│  ├─ routes/   auth · services · tickets · employee · admin ·     │
│  │            analytics · campus · integration · notifications   │
│  ├─ lib/      auth(JWT) · queueEngine · analytics · emailer ·    │
│  │            campus(Dijkstra) · validate · socket               │
│  ├─ storage/  storage factory ──┬─ MongoStore (mongodb driver)   │
│  │                              └─ JsonStore  (dev, data/db.json)│
│  └─ legacyApi.js  ← mock of the EXISTING queue system            │
└───────┬──────────────────────────────────┬──────────────────────┘
        │ MongoDB (set MONGODB_URI)        │ HTTP REST
┌───────▼──────────┐            ┌──────────▼──────────────────────┐
│  MongoDB         │            │  Legacy Queue System (mock)      │
│  (production)    │            │  /api/legacy/* — unchanged,      │
└──────────────────┘            │  we integrate, never replace     │
                                └─────────────────────────────────┘
```

### Key design decisions

- **Storage abstraction** — every query goes through `store.find/findOne/insert/update/delete`.
  Set `MONGODB_URI` to run on real MongoDB; leave it empty for the file-backed dev store.
  Same code, zero changes.
- **Priority model** — a high-priority ticket is scored as if it arrived
  `PRIORITY_BOOST_MIN` (default 45) earlier. It jumps the queue fairly
  (a normal ticket older than 45 min still goes first) — no starvation.
- **Queue engine** — atomic counter operations, auto no-show after
  `CALL_TIMEOUT_MIN`, position recomputation, ETA = position / open counters × avg service time.
- **Legacy integration** — `LegacyClient` speaks plain HTTP to the existing system.
  In dev it targets the built-in mock (`/api/legacy/*`); in production set
  `LEGACY_API_BASE` to the real system. Note: the client uses `node:http`
  because undici's `fetch` blocks "bad ports" (incl. 11).
- **Email** — real SMTP via nodemailer when `SMTP_HOST` is set; otherwise a dev
  mailer logs to console and persists every message to the admin notification log.

---

## 🚀 Running

```bash
cd "D:\flow control"
npm install
npm run seed     # demo users, 8 services, 20 counters, 14 days of history
npm start        # → http://localhost:3000
```

Open http://localhost:3000 directly. Set `PORT` in `.env` to use another free port.
For watch mode, run `npm run dev`. If a previous watch session is still running,
stop it with Ctrl+C before starting another.

### Demo accounts

| Role | Email | Password |
|---|---|---|
| Admin | admin@miu.edu.eg | Admin@1234 |
| Employee | officer@miu.edu.eg | Officer@1234 |
| Student | student@miu.edu.eg | Student@1234 |

Anyone can also self-register a student account from the login page.

### Configuration (`.env`)

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | 3000 | Server port |
| `MONGODB_URI` | *(empty)* | Empty = dev JSON store; set for real MongoDB |
| `JWT_SECRET` | dev secret | Sign JWTs — **change in production** |
| `LEGACY_API_BASE` | *(empty)* | Existing queue system base URL (empty = built-in mock) |
| `SMTP_HOST` / `SMTP_USER` / `SMTP_PASS` | *(empty)* | Real email delivery |
| `PRIORITY_BOOST_MIN` | `45` | How far priority tickets jump |
| `CALL_TIMEOUT_MIN` | `5` | Auto no-show after this long |
| `QUEUE_ALERT_THRESHOLD` | `15` | Alert admins when a queue exceeds this |

---

## 🔌 API overview

All under `http://localhost:3000/api`. Auth via `Authorization: Bearer <JWT>`.

| Method | Endpoint | Access | Description |
|---|---|---|---|
| POST | `/api/auth/register` | public | Student self-registration |
| POST | `/api/auth/login` | public | Login → `{ token, user }` |
| GET | `/api/auth/me` | auth | Current user |
| GET | `/api/services` | public | Service catalog + live stats |
| POST | `/api/services/:id/book` | student+ | Join queue |
| POST | `/api/services/legacy-book` | student+ | Book via legacy system |
| GET | `/api/services/:id/qr/:ticketId` | public | Ticket QR code (PNG) |
| GET | `/api/tickets/mine` | auth | My tickets with live ETAs |
| GET | `/api/tickets/:id` | owner/staff | Ticket detail |
| POST | `/api/tickets/:id/cancel` | owner | Cancel waiting ticket |
| POST | `/api/tickets/:id/feedback` | owner | Submit rating + comment |
| GET | `/api/tickets/:id/public` | public | QR verification payload |
| GET | `/api/employee/queues` | employee+ | Queues with counters |
| POST | `/api/employee/counters/:id/call` | employee+ | Call next ticket |
| POST | `/api/employee/tickets/:id/serve` | employee+ | Mark served |
| POST | `/api/employee/tickets/:id/noshow` | employee+ | Mark no-show |
| POST | `/api/employee/tickets/:id/recall` | employee+ | Re-announce called ticket |
| GET | `/api/admin/overview` | admin | Full dashboard payload |
| POST/PUT/DELETE | `/api/admin/services…` | admin | Service CRUD |
| POST/PUT | `/api/admin/counters…` | admin | Counter management |
| PUT | `/api/admin/users/:id` | admin | User management |
| GET | `/api/analytics/*` | employee+ | Overview, heatmap, services, forecast, trends, feedback |
| GET | `/api/campus/map` | public | Buildings + live markers |
| GET | `/api/campus/route?from=&to=` | public | Walking route |
| GET | `/api/integration/status` | employee+ | Legacy system status |
| POST | `/api/integration/sync` | employee+ | Pull legacy queues/tickets |
| GET | `/api/notifications` | auth | In-app notifications |
| * | `/api/legacy/*` | public | **Mock legacy system API** |

### Realtime events (Socket.io)

- Client → `auth <token>`, `subscribe service:<id>` / `ticket:<id>`
- Server → `queue:updated`, `ticket:created`, `ticket:called`, `ticket:served`,
  `ticket:cancelled`, `ticket:noshow`, `alert`

---

## 📁 Project structure

```
flow control/
├── server/
│   ├── index.js              # entry: Express + Socket.io + static SPA
│   ├── config/               # env configuration
│   ├── routes/               # auth, services, tickets, employee, admin,
│   │                         # analytics, campus, integration, notifications
│   └── lib/
│       ├── auth.js           # JWT + bcrypt + role guard
│       ├── queueEngine.js    # join/call/serve/no-show/cancel + legacy sync
│       ├── analytics.js      # KPIs, heatmap, forecast, trends, CSAT
│       ├── campus.js         # campus graph + Dijkstra routing
│       ├── emailer.js        # SMTP or dev mailer + notification log
│       ├── legacyApi.js      # mock of the existing queue system
│       ├── legacyClient.js   # REST client (node:http — port 11 safe)
│       ├── socket.js         # rooms + authenticated joins
│       ├── storage/          # MongoStore / JsonStore behind one interface
│       └── validate.js       # zero-dep input validation
├── public/                   # SPA (no build step)
│   ├── index.html
│   ├── css/style.css         # full design system
│   └── js/
│       ├── app.js            # hash router + bootstrap
│       ├── api.js            # fetch wrapper + socket client
│       ├── ui.js             # toasts, modals, SVG charts (bar/line/donut/heatmap)
│       └── views/            # landing, auth, portal, booking, ticket,
│                             # employee, admin, map, analytics, feedback
├── scripts/
│   ├── seed.js               # demo data generator
│   └── dev-proxy.js          # 8080 → 11 preview proxy
└── data/db.json              # dev database (auto-created)
```

## 🧪 Verified end-to-end

20-test API suite covering: JWT login, service catalog, booking with position/ETA,
call-next, serve, analytics, legacy health + sync + booking, campus routing,
QR generation, feedback, admin overview, priority jump, role guard (403 for
students on admin routes), notifications, heatmap/forecast/trends/feedback
endpoints, and live map markers.
