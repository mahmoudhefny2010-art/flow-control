// App bootstrap: hash router + navigation + socket wiring
import { api, socket } from './api.js';
import { renderLanding } from './views/landing.js';
import { renderLogin, renderRegister } from './views/auth.js';
import { renderPortal } from './views/portal.js';
import { renderBooking } from './views/booking.js';
import { renderTicket } from './views/ticket.js';
import { renderEmployee } from './views/employee.js';
import { renderAdmin } from './views/admin.js';
import { renderMap } from './views/map.js';
import { renderAnalytics } from './views/analytics.js';
import { renderFeedback } from './views/feedback.js';
import { initials, escapeHtml } from './ui.js';

const routes = [
  { pattern: /^\/$/, render: (view, params) => renderLanding(view, params), nav: { label: 'Home', href: '#/', roles: null } },
  { pattern: /^\/login$/, render: (view) => renderLogin(view), nav: null },
  { pattern: /^\/register$/, render: (view) => renderRegister(view), nav: null },
  { pattern: /^\/portal$/, render: (view) => renderPortal(view), nav: { label: 'My Queue', href: '#/portal', roles: null } },
  { pattern: /^\/portal\/book$/, render: (view) => renderBooking(view), nav: null },
  { pattern: /^\/book$/, render: (view) => renderBooking(view), nav: null },
  { pattern: /^\/book\/([a-z0-9-]+)$/i, render: (view, m) => renderBooking(view, new URLSearchParams(`service=${m[1]}`)), nav: null },
  { pattern: /^\/ticket\/([a-z0-9-]+)$/i, render: (view, m) => renderTicket(view, m[1]), nav: null },
  { pattern: /^\/employee$/, render: (view) => renderEmployee(view), nav: { label: 'Employee', href: '#/employee', roles: ['employee', 'admin'] } },
  { pattern: /^\/admin$/, render: (view, params) => renderAdmin(view, params), nav: { label: 'Admin', href: '#/admin', roles: ['admin'] } },
  { pattern: /^\/map$/, render: (view) => renderMap(view), nav: { label: 'Campus Map', href: '#/map', roles: null } },
  { pattern: /^\/analytics$/, render: (view) => renderAnalytics(view), nav: { label: 'Analytics', href: '#/analytics', roles: ['employee', 'admin'] } },
  { pattern: /^\/feedback(?:\/([a-z0-9-]+))?$/i, render: (view, m) => renderFeedback(view, m[1]), nav: null },
];

let currentCleanup = null;

function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, query] = raw.split('?');
  return { path: path || '/', params: new URLSearchParams(query || '') };
}

function renderNav() {
  const nav = document.getElementById('mainNav');
  nav.innerHTML = routes
    .filter((r) => r.nav)
    .filter((r) => !r.nav.roles || (api.user && r.nav.roles.includes(api.user.role)))
    .map((r) => `<a href="${r.nav.href}" data-nav="${r.nav.href}">${r.nav.label}</a>`)
    .join('');

  // auth-aware right side
  const chip = document.getElementById('userChip');

  if (api.user) {
    chip.hidden = false;
    document.getElementById('userAvatar').textContent = initials(api.user.name);
    document.getElementById('userName').textContent = api.user.name;
    document.getElementById('userRole').textContent = api.user.role;
  } else {
    chip.hidden = true;
  }
}

function highlightNav(path) {
  document.querySelectorAll('[data-nav]').forEach((a) => {
    const href = a.dataset.nav;
    const isActive = href === '#/' ? path === '/' : path.startsWith(href.replace('#', ''));
    a.classList.toggle('active', isActive);
  });
}

async function route() {
  const { path, params } = parseHash();
  const view = document.getElementById('view');
  const topbar = document.getElementById('topbar');

  // Always show topbar (public pages: landing + booking need nav too)
  topbar.hidden = false;
  renderNav();
  highlightNav(path);

  if (currentCleanup) {
    try { currentCleanup(); } catch { /* noop */ }
    currentCleanup = null;
  }

  for (const r of routes) {
    const m = path.match(r.pattern);
    if (m) {
      try {
        const cleanup = await r.render(view, params, m);
        if (typeof cleanup === 'function') currentCleanup = cleanup;
      } catch (err) {
        console.error(err);
        view.innerHTML = `<div class="empty"><div class="e-icon">⚠️</div><h3>Something went wrong</h3><p class="muted">${escapeHtml(err.message)}</p></div>`;
      }
      window.scrollTo({ top: 0 });
      return;
    }
  }
  view.innerHTML = `<div class="empty"><div class="e-icon">🔍</div><h3>Page not found</h3><p class="muted"><a href="#/">Go home</a></p></div>`;
}

// --- global handlers -------------------------------------------------
document.getElementById('logoutBtn').onclick = () => {
  api.logout();
  socket.emit('auth', '');
  toast('Signed out', 'See you soon 👋', 'info');
  location.hash = '#/';
  route();
};

window.addEventListener('hashchange', route);

// validate stored token on boot
(async function init() {
  if (api.token && !api.user) {
    try {
      const { user } = await api.get('/api/auth/me');
      api.user = user;
      socket.emit('auth', api.token);
    } catch {
      api.logout();
    }
  } else if (api.token && api.user) {
    socket.emit('auth', api.token);
  }
  route();
})();
