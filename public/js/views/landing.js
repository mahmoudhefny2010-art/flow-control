// Public service discovery and live queue overview.
import { api, socket } from '../api.js';
import { escapeHtml, etaText } from '../ui.js';

export async function renderLanding(view, params) {
  view.innerHTML = `<div class="spinner"></div>`;

  let services = [];
  try {
    const data = await api.get('/api/services');
    services = data.services;
  } catch (err) {
    toast('Could not load services', err.message, 'error');
  }

  const totalWaiting = services.reduce((a, s) => a + s.waiting, 0);
  const totalCalled = services.reduce((a, s) => a + s.called, 0);
  const openCounters = services.reduce((a, s) => a + s.openCounters, 0);

  view.innerHTML = `
    <section class="hero">
      <h1>Skip the line at Misr International University</h1>
      <p>Book a virtual queue ticket from your phone, track your position live, and get notified the moment your turn arrives — across every student service on campus.</p>
      <div class="flex" style="gap:12px;flex-wrap:wrap">
        <a class="btn gold lg" href="#/portal">📋 Book a ticket</a>
        <a class="btn lg" style="background:rgba(255,255,255,.14);color:#fff" href="#/map">🗺️ Campus map</a>
      </div>
      <div class="hero-stats">
        <div class="hero-stat"><b class="mono">${services.length}</b><span>Services</span></div>
        <div class="hero-stat"><b class="mono">${totalWaiting}</b><span>Waiting now</span></div>
        <div class="hero-stat"><b class="mono">${openCounters}</b><span>Open counters</span></div>
        <div class="hero-stat"><b class="mono">${totalCalled}</b><span>Being served</span></div>
      </div>
    </section>

    <div class="feature-grid">
      <div class="feature"><div class="f-icon">📱</div><h4>User Portal</h4><p>Book, track and cancel queue tickets from any device with live QR tickets.</p></div>
      <div class="feature"><div class="f-icon">⭐</div><h4>Priority Queue</h4><p>Fair priority lanes for faculty, staff and accessibility needs — no more starving queues.</p></div>
      <div class="feature"><div class="f-icon">🖥️</div><h4>Employee Dashboard</h4><p>Call-next, serve, recall and no-show controls with real-time sync to every screen.</p></div>
      <div class="feature"><div class="f-icon">📊</div><h4>Smart Analytics</h4><p>Wait-time trends, hourly heatmaps, demand forecasts and CSAT feedback insights.</p></div>
    </div>

    <div class="page-head-row">
      <div class="page-head"><h2>Services & live queues</h2><div class="sub">Live data refreshes automatically</div></div>
      <a class="btn primary" href="#/portal">Open user portal →</a>
    </div>

    <div class="grid cols-4" id="liveServices">
      ${services.map(serviceCard).join('') || '<div class="empty"><div class="e-icon">🗂️</div>No services available right now.</div>'}
    </div>

    <div class="section-gap grid cols-2">
      <div class="card card-pad">
        <h3 class="card-title">🖥️ Employee & admin tools</h3>
        <p class="muted small">Service desk officers manage counters and call the next ticket; administrators configure services, monitor thresholds and integrate the legacy queue system.</p>
        <div class="flex" style="gap:10px;margin-top:12px;flex-wrap:wrap">
          <a class="btn ghost sm" href="#/employee">Employee dashboard</a>
          <a class="btn ghost sm" href="#/admin">Admin dashboard</a>
          <a class="btn ghost sm" href="#/analytics">Analytics</a>
        </div>
      </div>
      <div class="card card-pad">
        <h3 class="card-title">🔗 Legacy system integration</h3>
        <p class="muted small">QueueFlow integrates with the university's existing queue system over REST APIs — no replacement required. Sync queues and tickets from the admin panel.</p>
        <div class="flex" style="gap:10px;margin-top:12px">
          <a class="btn ghost sm" href="#/admin?tab=integration">Open integration panel</a>
        </div>
      </div>
    </div>
  `;
  let services = [];
  let failed = false;
  let disposed = false;
  let loading = false;
  const select = selector => view.querySelector(selector);
  function renderServices() {
    const query = select('#serviceSearch').value.trim().toLowerCase();
    const visible = services.filter(s => (s.name + ' ' + (s.building || '')).toLowerCase().includes(query));
    select('#serviceCount').textContent = failed ? 'Unavailable' : visible.length + ' services';
    select('#liveServices').innerHTML = visible.map(s => {
      const closed = !s.openCounters;
      const level = closed ? 'grey' : s.waiting === 0 ? 'success' : s.waiting < 8 ? 'warn' : 'danger';
      const label = closed ? 'Counters closed' : s.waiting === 0 ? 'No queue' : s.waiting < 8 ? 'Moderate' : 'Busy';
      return `<a class="card service-card" href="#/book/${encodeURIComponent(s._id)}"><div class="sc-head"><span class="service-initial" aria-hidden="true">${escapeHtml(s.name.slice(0,2).toUpperCase())}</span><span class="badge ${level}">${label}</span></div><h3>${escapeHtml(s.name)}</h3><p class="sc-meta">${escapeHtml(s.building || 'Campus service')}${s.floor ? ' &middot; Floor ' + escapeHtml(String(s.floor)) : ''}</p><div class="sc-stats"><div class="sc-stat"><b>${s.waiting}</b><span>Waiting</span></div><div class="sc-stat"><b>${etaText(s.avgServiceMinutes)}</b><span>Typical visit</span></div><div class="sc-stat"><b>${s.openCounters}</b><span>Open desks</span></div></div><div class="service-link">View service <span aria-hidden="true">&#8599;</span></div></a>`;
    }).join('') || `<div class="empty services-empty"><h3>${failed ? 'Services are temporarily unavailable' : query ? 'No matching services' : 'No services available yet'}</h3><p>${failed ? 'Please try loading the service list again.' : query ? 'Try another service name or building.' : 'Services will appear here once they are available.'}</p>${failed ? '<button class="btn primary" id="retryServices">Try again</button>' : ''}</div>`;
    select('#retryServices')?.addEventListener('click', refresh);
  }
  async function refresh() {
    if (loading || disposed) return;
    loading = true;
    try {
      const data = await api.get('/api/services');
      if (disposed) return;
      services = data.services;
      failed = false;
      select('#statServices').textContent = services.length;
      for (const [id, key] of [['statWaiting','waiting'], ['statCounters','openCounters'], ['statCalled','called']]) select('#' + id).textContent = services.reduce((sum, s) => sum + (Number(s[key]) || 0), 0);
      select('#dataStatus').textContent = 'Updated ' + new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
    } catch {
      if (disposed) return;
      failed = true;
      services = [];
      for (const id of ['statServices','statWaiting','statCounters','statCalled']) select('#' + id).textContent = '\u2014';
      select('#dataStatus').textContent = 'Queue data unavailable';
    } finally { loading = false; }
    if (!disposed) renderServices();
  }
  select('#serviceSearch').addEventListener('input', renderServices);
  socket.on('queue:updated', refresh);
  socket.on('connect', refresh);
  const timer = setInterval(refresh, 30000);
  refresh();
  return () => { disposed = true; clearInterval(timer); socket.off('queue:updated', refresh); socket.off('connect', refresh); };
}
