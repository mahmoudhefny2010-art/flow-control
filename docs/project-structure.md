# Project structure

QueueFlow keeps the Node.js server, browser app, operational scripts, and project documentation in separate top-level folders. The browser app is served directly by Express and uses native JavaScript modules; no frontend build step is required.

```text
flow-control/
├── public/                 # Browser app and files served by Express
│   ├── index.html          # Shared SPA shell
│   ├── pages/              # Direct-link shells, e.g. account.html, home.html
│   ├── components/         # Shared header/footer HTML and CSS
│   │   ├── site-header.html
│   │   ├── site-header.css
│   │   ├── site-footer.html
│   │   └── site-footer.css
│   ├── css/
│   │   ├── style.css       # Shared design system
│   │   └── pages/          # Route-specific styles
│   ├── images/             # Logos and static image assets
│   └── js/
│       ├── app.js          # Hash router and app bootstrap
│       ├── api.js          # HTTP client, session, and Socket.IO
│       ├── ui.js           # Shared interface helpers
│       └── views/          # Screen renderers by feature
├── server/
│   ├── index.js            # Express and Socket.IO entry point
│   ├── config/             # Environment-backed configuration
│   ├── routes/             # HTTP API endpoints by feature
│   └── lib/                # Auth, queue logic, integrations, storage
├── scripts/                # Seed data and local development proxy
├── index.js                # Vercel Express entry point
├── tests/                  # Automated Node.js tests, grouped by feature
│   └── auth/               # Authentication tests
├── docs/                   # Setup and architecture notes
├── data/                   # Local JSON database (generated, ignored by Git)
├── .env.example            # Safe configuration template
├── package.json            # Dependencies and developer commands
└── README.md               # Product overview and getting started
```

## Where to make changes

- Change API behavior in the matching file under `server/routes/`; put reusable server logic under `server/lib/`.
- Change a screen in `public/js/views/` and shared navigation or routing in `public/js/app.js`.
- Keep shared CSS in `public/css/style.css`; put screen-only overrides in `public/css/pages/`.
- Add static assets to `public/images/` so Express can serve them directly.
- Add local utilities to `scripts/`, automated tests to `tests/`, and setup notes to `docs/`.

The HTML files under `public/pages/` are direct-link entry shells named by route, such as `account.html` and `home.html`. They set an initial route while loading the same app shell and shared modules as `/`. Old `/pages/<route>/` links redirect to the matching flat HTML file.

## Local configuration

Copy `.env.example` to `.env` and fill in only the services you use. `.env`, database files, and credentials are ignored by Git. Google sign-in configuration is described in [Google sign-in setup](google-sign-in.md).
