// Public service discovery and live queue overview.
import { api, socket } from '../api.js';
import { escapeHtml, etaText } from '../ui.js';

export async function renderLanding(view, params) {
  view.innerHTML = `<div class="spinner"></div>`;

  view.innerHTML = `
    <div class="landing-content">
    <section class="hero">
      <div class="hero-content">
        <div class="hero-copy">
          <h1>Skip the line at Misr International University</h1>
          <p>Book your ticket, track your place, and come when it’s your turn.</p>
          <div class="hero-stats">
            <div class="hero-stat"><b class="mono" id="statServices">—</b><span>Services</span></div>
            <div class="hero-stat"><b class="mono" id="statWaiting">—</b><span>Waiting now</span></div>
            <div class="hero-stat"><b class="mono" id="statCounters">—</b><span>Open counters</span></div>
            <div class="hero-stat"><b class="mono" id="statCalled">—</b><span>Being served</span></div>
          </div>
        </div>
        <div class="hero-actions">
          <a class="btn gold lg" href="#/portal">📋 Book a ticket</a>
        </div>
      </div>
    </section>

    <section class="quick-guide" aria-label="How to use QueueFlow">
      <div class="quick-guide-title"><span class="quick-guide-icon">↗</span><div><strong>Your visit, made easier</strong><small>Three quick steps, all from your phone</small></div></div>
      <div class="quick-guide-step"><span>1</span><div><strong>Choose an office</strong><small>Advising or Registrar</small></div></div>
      <div class="quick-guide-step"><span>2</span><div><strong>Get your ticket</strong><small>See your live place in line</small></div></div>
      <div class="quick-guide-step"><span>3</span><div><strong>Come when called</strong><small>No waiting in a physical line</small></div></div>
    </section>

    <section class="services-section" aria-labelledby="servicesTitle">
      <div class="services-heading">
        <div><span class="services-eyebrow">MIU STUDENT SERVICES</span><h2 id="servicesTitle">Choose an office</h2><p>Check the live queue, then book your place.</p></div>
        <span class="live-status"><i></i><span id="dataStatus" role="status">Connecting…</span></span>
      </div>
      <div class="service-toolbar"><label class="service-search"><span aria-hidden="true">⌕</span><input id="serviceSearch" type="search" placeholder="Find an office" aria-label="Search services or buildings"></label><span id="serviceCount" class="service-count"></span></div>
      <div class="grid cols-2" id="liveServices"><div class="empty">Loading services…</div></div>
    </section>

    <a class="staff-tools-link" href="#/employee"><span class="staff-tools-icon">↗</span><span><strong>Staff workspace</strong><small>Employee and administrator tools</small></span><span class="staff-tools-arrow">→</span></a>
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
      const level = s.waiting === 0 ? 'success' : s.waiting < 8 ? 'warn' : 'danger';
      const label = s.waiting === 0 ? 'No wait' : s.waiting < 8 ? 'Moderate' : 'Busy';
      return `<a class="card service-card" href="#/book/${encodeURIComponent(s._id)}" style="text-decoration:none;color:inherit"><div class="sc-head"><div><h4>${escapeHtml(s.name)}</h4><div class="sc-meta">${escapeHtml(s.building)}${s.floor ? ' · Floor ' + escapeHtml(String(s.floor)) : ''}</div></div><span class="badge ${level}">${label}</span></div><div class="sc-stats"><div class="sc-stat"><b class="mono">${s.waiting}</b><span>Waiting</span></div><div class="sc-stat"><b class="mono">${s.called}</b><span>Called</span></div><div class="sc-stat"><b class="mono">${etaText(s.estimatedWaitMinutes)}</b><span>Est. wait</span></div></div><div class="sc-meta small">⏱️ Avg wait today: ${s.avgWaitSamples ? etaText(s.avgWaitMinutesToday) : 'Collecting data'} · ~${s.avgServiceMinutes} min per visit ${s.priorityEnabled ? '· ⭐ priority enabled' : ''}</div></a>`;
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
