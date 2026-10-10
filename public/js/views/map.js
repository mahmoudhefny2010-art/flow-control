// Live campus map with queue locations
import { api, socket } from '../api.js';
import { toast, etaText, escapeHtml } from '../ui.js';

const BUILDING_EMOJI = {
  gate: '🚪', academic: '🏛️', services: '🏢', sports: '🏟️', parking: '🅿️',
};

export async function renderMap(view) {
  view.innerHTML = `<div class="spinner"></div>`;
  const data = await api.get('/api/campus/map').catch(() => null);
  if (!data) {
    view.innerHTML = `<div class="empty"><div class="e-icon">🗺️</div><h3>Map unavailable</h3></div>`;
    return;
  }
  let { buildings, paths, markers } = data;

  const paint = () => {
    view.innerHTML = `
      <div class="page-head-row">
        <div class="page-head"><h1>Campus Map</h1>
          <div class="sub">Live queue occupancy across campus — click a marker for details</div>
        </div>
        <div class="flex">
          <span class="badge success">● Low</span>
          <span class="badge warn">● Moderate</span>
          <span class="badge danger">● Busy</span>
        </div>
      </div>

      <div class="map-shell">
        <div class="map-canvas">
          <svg viewBox="0 0 1000 640" id="campusSvg">
            ${svgDefs()}
            ${grounds()}
            ${pathLines()}
            ${buildings.map(b => buildingNode(b)).join('')}
            ${markers.map(m => serviceMarker(m)).join('')}
          </svg>
        </div>

        <div class="card map-panel" id="mapPanel">
          <h3>Select a location</h3>
          <p class="small muted">Click any <b>queue marker</b> (colored dot) to see live stats and book a ticket, or click a building for directions from the Main Gate.</p>
          <div id="mapDetail"></div>
          <div style="margin-top:14px">
            <div class="small muted" style="margin-bottom:6px"><b>Quick route</b></div>
            <div class="form-row">
              <select class="select" id="routeFrom">
                ${buildings.map((b) => `<option value="${b.id}">${escapeHtml(b.name)}</option>`).join('')}
              </select>
              <select class="select" id="routeTo">
                ${buildings.map((b) => `<option value="${b.id}" ${b.id === 'library' ? 'selected' : ''}>${escapeHtml(b.name)}</option>`).join('')}
              </select>
            </div>
            <button class="btn ghost sm" style="margin-top:8px" id="routeBtn">Find walking route</button>
            <div id="routeResult" style="margin-top:10px"></div>
          </div>
        </div>
      </div>`;

    wire();
  };

  function svgDefs() {
    return `
      <defs>
        <pattern id="trees" x="0" y="0" width="60" height="60" patternUnits="userSpaceOnUse">
          <circle cx="12" cy="14" r="7" fill="#cfe4cf"/>
          <circle cx="40" cy="42" r="8" fill="#c6dfc6"/>
        </pattern>
        <linearGradient id="walk" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#f7f4ec"/><stop offset="1" stop-color="#efe9da"/>
        </linearGradient>
      </defs>`;
  }

  function grounds() {
    return `
      <rect x="0" y="0" width="1000" height="640" fill="url(#trees)" opacity="0.5"/>
      <rect x="60" y="40" width="880" height="520" rx="26" fill="url(#walk)" stroke="#ddd5c2" stroke-width="2"/>
      <rect x="90" y="70" width="820" height="460" rx="18" fill="none" stroke="#e3dcc9" stroke-width="1.5" stroke-dasharray="6 5"/>
      <text x="500" y="580" text-anchor="middle" font-size="13" fill="#9a8f74" font-style="italic">Misr International University — Campus</text>`;
  }

  function pathLines() {
    const byId = Object.fromEntries(buildings.map((b) => [b.id, b]));
    return paths.map(([a, b]) => {
      const A = byId[a]; const B = byId[b];
      if (!A || !B) return '';
      const mx = (A.x + B.x) / 2 + (A.y - B.y) * 0.08;
      const my = (A.y + B.y) / 2 + (B.x - A.x) * 0.08;
      return `<path d="M${A.x},${A.y} Q${mx.toFixed(0)},${my.toFixed(0)} ${B.x},${B.y}"
        fill="none" stroke="#ffffff" stroke-width="14" stroke-linecap="round" opacity="0.85"/>
        <path d="M${A.x},${A.y} Q${mx.toFixed(0)},${my.toFixed(0)} ${B.x},${B.y}"
        fill="none" stroke="#c9bfa5" stroke-width="1.4" stroke-dasharray="5 6"/>`;
    }).join('');
  }

  function buildingNode(b) {
    const w = b.type === 'gate' ? 90 : 120;
    const h = b.type === 'gate' ? 40 : 56;
    return `
      <g class="map-marker" data-building="${b.id}">
        <rect x="${b.x - w / 2}" y="${b.y - h / 2}" width="${w}" height="${h}" rx="10"
          fill="#ffffff" stroke="#c9c2ae" stroke-width="1.6"/>
        <text x="${b.x}" y="${b.y - 4}" text-anchor="middle" font-size="15">${BUILDING_EMOJI[b.type] || '🏢'}</text>
        <text x="${b.x}" y="${b.y + 14}" text-anchor="middle" font-size="11.5" font-weight="600" fill="#4a4436">${escapeHtml(b.name)}</text>
      </g>`;
  }

  function serviceMarker(m) {
    const pulse = m.level === 'high'
      ? `<circle cx="${m.x}" cy="${m.y}" r="16" fill="none" stroke="#d64545" stroke-width="2" opacity="0.6">
           <animate attributeName="r" values="12;22;12" dur="2s" repeatCount="indefinite"/>
           <animate attributeName="opacity" values="0.7;0;0.7" dur="2s" repeatCount="indefinite"/>
         </circle>`
      : '';
    return `
      <g class="map-marker" data-service="${m.serviceId}">
        ${pulse}
        <circle cx="${m.x}" cy="${m.y}" r="13" fill="#fff" stroke="${markerColor(m.level)}" stroke-width="2.5"/>
        <circle cx="${m.x}" cy="${m.y}" r="7.5" class="marker-${m.level}"/>
        <text x="${m.x}" y="${m.y + 30}" text-anchor="middle" font-size="10.5" font-weight="700" fill="#333">${m.code}</text>
        <title>${escapeHtml(m.name)} — ${m.waiting} waiting</title>
      </g>`;
  }

  function markerColor(level) {
    return level === 'low' ? '#1f9d55' : level === 'medium' ? '#d97706' : '#d64545';
  }

  function wire() {
    // service marker click -> detail + booking
    view.querySelectorAll('[data-service]').forEach((el) => {
      el.onclick = () => {
        const m = markers.find((x) => x.serviceId === el.dataset.service);
        showServiceDetail(m);
      };
    });
    // building click -> route from gate
    view.querySelectorAll('[data-building]').forEach((el) => {
      el.onclick = () => {
        const b = buildings.find((x) => x.id === el.dataset.building);
        document.getElementById('routeTo').value = b.id;
        document.getElementById('routeFrom').value = 'gate';
        findRoute();
      };
    });
    document.getElementById('routeBtn').onclick = findRoute;
  }

  function showServiceDetail(m) {
    const host = document.getElementById('mapDetail');
    host.innerHTML = `
      <div class="card card-pad" style="background:var(--bg);margin-top:10px">
        <div class="flex-between">
          <div>
            <h3 style="font-size:15px">${escapeHtml(m.name)}</h3>
            <div class="small muted">${escapeHtml(m.building)} · code <b class="mono">${m.code}</b></div>
          </div>
          <span class="badge ${m.level === 'low' ? 'success' : m.level === 'medium' ? 'warn' : 'danger'}">
            ${m.waiting} waiting
          </span>
        </div>
        <div class="sc-stats" style="margin-top:10px">
          <div class="sc-stat"><b class="mono">${m.waiting}</b><span>Queue</span></div>
          <div class="sc-stat"><b class="mono">${m.called}</b><span>Called</span></div>
          <div class="sc-stat"><b class="mono">${m.waiting >= 15 ? '🔥' : m.waiting >= 8 ? '⚠️' : '✅'}</b><span>Status</span></div>
        </div>
        <a class="btn primary btn-block sm" style="margin-top:12px" href="#/book/${m.serviceId}">Book this queue →</a>
      </div>`;
  }

  async function findRoute() { {
    const from = document.getElementById('routeFrom').value;
    const to = document.getElementById('routeTo').value;
    const res = await api.get(`/api/campus/route?from=${from}&to=${to}`).catch(() => null);
    const host = document.getElementById('routeResult');
    if (!res) { host.innerHTML = '<div class="small" style="color:var(--danger)">Route not found</div>'; return; }
    const nameOf = (id) => (buildings.find((b) => b.id === id) || {}).name || id;
    host.innerHTML = `
      <div class="card card-pad" style="background:var(--bg)">
        <div class="flex-between" style="margin-bottom:6px">
          <b class="small">${escapeHtml(nameOf(res.from))} → ${escapeHtml(nameOf(res.to))}</b>
          <span class="badge accent">${res.minutes} min walk</span>
        </div>
        <div class="small muted mono">${(res.meters / 1000).toFixed(2)} km</div>
        <div style="margin-top:8px">
          ${res.path.map((p, i) => `
            <div class="map-route-step">
              <span style="width:18px;text-align:center">${i === 0 ? '🚶' : i === res.path.length - 1 ? '📍' : '↳'}</span>
              <span>${escapeHtml(nameOf(p))}</span>
            </div>`).join('')}
        </div>
        ${res.servicesAtDestination.length ? `
          <div style="margin-top:10px">
            <div class="small muted" style="margin-bottom:6px"><b>Services here</b></div>
            ${res.servicesAtDestination.map((s) => {
              const mk = markers.find((x) => x.serviceId === s._id);
              return `<div class="flex-between" style="padding:5px 0">
                <span class="small">${escapeHtml(s.name)}</span>
                <div class="flex" style="gap:6px">
                  <span class="badge ${mk ? (mk.level === 'low' ? 'success' : mk.level === 'medium' ? 'warn' : 'danger') : 'grey'}">${mk ? mk.waiting + ' waiting' : '—'}</span>
                  <a class="btn sm primary" href="#/book/${s._id}">Book</a>
                </div>
              </div>`;
            }).join('')}
          </div>` : ''}
      </div>`;
  } }

  paint();

  // live marker updates
  const handler = async () => {
    const fresh = await api.get('/api/campus/map').catch(() => null);
    if (fresh) { markers = fresh.markers; paint(); }
  };
  socket.on('queue:updated', handler);
  return () => socket.off('queue:updated', handler);
}
