// App bootstrap: hash router + navigation + socket wiring
import { api, socket } from './api.js';
import { renderLanding } from './views/landing.js?v=queueflow-live-wait-20261010-1';
import { renderLogin, renderRegister } from './views/auth.js?v=queueflow-usher-accounts-20261010-3';
import { renderPortal } from './views/portal.js?v=queueflow-admin-dates-20261010-1';
import { renderBooking } from './views/booking.js?v=queueflow-live-wait-20261010-1';
import { renderTicket } from './views/ticket.js';
import { renderEmployee } from './views/employee.js';
import { renderAdmin } from './views/admin.js?v=queueflow-usher-accounts-20261010-3';
import { renderAnalytics } from './views/analytics.js?v=queueflow-live-wait-20261010-1';
import { renderFeedback } from './views/feedback.js';
import { renderRegistrar } from './views/registrar.js';
import { renderOutside } from './views/outside.js';
import { renderRoom } from './views/room.js';
import { initials, escapeHtml, toast } from './ui.js';
import { renderAccount } from './views/account.js?v=queueflow-usher-accounts-20261010-3';

async function loadSharedComponents() {
  const [headerResponse, footerResponse] = await Promise.all([
    fetch('/components/site-header.html?v=nav-responsive-dark-20261011-1'),
    fetch('/components/site-footer.html?v=footer-custom-20261011-1'),
  ]);
  if (!headerResponse.ok || !footerResponse.ok) {
    throw new Error('Could not load shared page components');
  }
  const [headerMarkup, footerMarkup] = await Promise.all([
    headerResponse.text(),
    footerResponse.text(),
  ]);
  const headerSlot = document.getElementById('siteHeader');
  const footerSlot = document.getElementById('siteFooter');
  if (!headerSlot) throw new Error('Missing site header component slot');
  if (!footerSlot) throw new Error('Missing site footer component slot');
  headerSlot.outerHTML = headerMarkup;
  footerSlot.outerHTML = footerMarkup;
}

await loadSharedComponents();

const THEME_STORAGE_KEY = 'queueflow-theme';
const themeToggle = document.getElementById('themeToggle');

function setTheme(theme, persist = true) {
  const darkMode = theme === 'dark';
  document.documentElement.dataset.theme = darkMode ? 'dark' : 'light';
  if (persist) {
    try { localStorage.setItem(THEME_STORAGE_KEY, darkMode ? 'dark' : 'light'); } catch { /* storage may be unavailable */ }
  }
  themeToggle.setAttribute('aria-pressed', String(darkMode));
  const action = darkMode ? 'light' : 'dark';
  themeToggle.setAttribute('aria-label', `Switch to ${action} mode`);
  themeToggle.title = `Switch to ${action} mode`;
}

let savedTheme = 'light';
try { savedTheme = localStorage.getItem(THEME_STORAGE_KEY) || 'light'; } catch { /* use light mode when storage is unavailable */ }
setTheme(savedTheme, false);
themeToggle.addEventListener('click', () => {
  setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
});

const routes = [
  { pattern: /^\/$/, render: (view, params) => renderLanding(view, params), nav: { label: 'Home', href: '#/', roles: null } },
  { pattern: /^\/account$/, render: (view) => renderAccount(view), nav: null },
  { pattern: /^\/login$/, render: (view, params) => renderLogin(view, params), nav: null },
  { pattern: /^\/register$/, render: (view) => renderRegister(view), nav: null },
  { pattern: /^\/portal$/, render: (view) => renderPortal(view), nav: { label: 'My Queue', href: '#/portal', roles: null } },
  { pattern: /^\/portal\/book$/, render: (view, params) => renderBooking(view, params), nav: null },
  { pattern: /^\/book$/, render: (view, params) => renderBooking(view, params), nav: null },
  { pattern: /^\/book\/([a-z0-9-]+)$/i, render: (view, params, m) => renderBooking(view, new URLSearchParams(`service=${m[1]}`)), nav: null },
  { pattern: /^\/ticket\/([a-z0-9-]+)$/i, render: (view, params, m) => renderTicket(view, m[1]), nav: null },
  { pattern: /^\/employee$/, render: (view) => renderEmployee(view), nav: { label: 'Employee', href: '#/employee', roles: ['employee'] } },
  { pattern: /^\/outside$/, render: (view) => renderOutside(view), nav: { label: 'Entrance Check-in', href: '#/outside', roles: ['outside-usher'] } },
  { pattern: /^\/room$/, render: (view) => renderRoom(view), nav: { label: 'Room Usher', href: '#/room', roles: ['room-usher'] } },
  { pattern: /^\/registrar$/, render: (view) => renderRegistrar(view), nav: { label: 'Registrar Room', href: '#/registrar', roles: ['registrar-staff'] } },
  { pattern: /^\/admin$/, render: (view, params) => renderAdmin(view, params), nav: { label: 'Admin', href: '#/admin', roles: ['admin'] } },
  { pattern: /^\/analytics$/, render: (view) => renderAnalytics(view), nav: { label: 'Analytics', href: '#/analytics', roles: ['employee', 'admin'] } },
  { pattern: /^\/feedback(?:\/([a-z0-9-]+))?$/i, render: (view, params, m) => renderFeedback(view, m[1]), nav: null },
];

let currentCleanup = null;

function parseHash() {
  const raw = location.hash.replace(/^#/, '') || document.body.dataset.defaultRoute || '/';
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
  const loginLink = document.getElementById('loginLink');
  const accountLink = document.getElementById('accountLink');
  const dashboardLink = document.getElementById('dashboardLink');
  const dashboards = {
    admin: '#/admin', employee: '#/employee', 'registrar-staff': '#/registrar',
    'room-usher': '#/room', 'outside-usher': '#/outside',
  };

  if (api.user) {
    chip.hidden = false;
    loginLink.hidden = true;
    accountLink.hidden = false;
    dashboardLink.hidden = !dashboards[api.user.role];
    if (dashboards[api.user.role]) dashboardLink.href = dashboards[api.user.role];
    document.getElementById('userAvatar').textContent = initials(api.user.name);
    document.getElementById('userName').textContent = api.user.name;
    document.getElementById('userRole').textContent = api.user.role;
  } else {
    chip.hidden = true;
    loginLink.hidden = false;
    accountLink.hidden = true;
    dashboardLink.hidden = true;
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
  loadPageStyles(path);

  // Always show topbar (public pages: landing + booking need nav too)
  topbar.hidden = false;
  view.classList.toggle('landing', path === '/');
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
        view.innerHTML = `<div class="empty"><div class="e-icon">âš ï¸</div><h3>Something went wrong</h3><p class="muted">${escapeHtml(err.message)}</p></div>`;
      }
      window.scrollTo({ top: 0 });
      return;
    }
  }
  view.innerHTML = `<div class="empty"><div class="e-icon">ðŸ”</div><h3>Page not found</h3><p class="muted"><a href="#/">Go home</a></p></div>`;
}

let pageStylesheet = null;
function loadPageStyles(path) {
  const pages = [
    ['/', 'home'], ['/login', 'auth'], ['/register', 'auth'], ['/account', 'account'],
    ['/portal/book', 'booking'], ['/portal', 'portal'], ['/book', 'booking'], ['/ticket', 'ticket'],
    ['/employee', 'employee'], ['/outside', 'outside'], ['/room', 'room'],
    ['/registrar', 'registrar'], ['/admin', 'admin'], ['/analytics', 'analytics'], ['/feedback', 'feedback'],
  ];
  const page = pages.find(([prefix]) => prefix === '/' ? path === '/' : path === prefix || path.startsWith(prefix + '/'))?.[1];
  const href = page ? `/css/pages/${page}.css?v=queueflow-usher-accounts-20261010-3` : '';
  if (pageStylesheet?.getAttribute('href') === href) return;
  pageStylesheet?.remove();
  pageStylesheet = null;
  if (href) {
    pageStylesheet = document.createElement('link');
    pageStylesheet.rel = 'stylesheet';
    pageStylesheet.href = href;
    document.head.append(pageStylesheet);
  }
}

// --- global handlers -------------------------------------------------
document.getElementById('logoutBtn').onclick = () => {
  api.logout();
  socket.emit('auth', '');
  toast('Signed out', 'See you soon ðŸ‘‹', 'info');
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
