// UI helpers: toasts, modals, formatting, lightweight SVG charts
export function toast(title, body = '', type = 'info', ms = 4200) {
  const stack = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  const icons = { info: 'ℹ️', success: '✅', error: '⛔', warn: '⚠️' };
  el.innerHTML = `
    <span>${icons[type] || icons.info}</span>
    <div class="t-body"><div class="t-title"></div><div class="t-text"></div></div>
    <button class="t-close" aria-label="close">×</button>`;
  el.querySelector('.t-title').textContent = title;
  el.querySelector('.t-text').textContent = body;
  el.querySelector('.t-close').onclick = () => el.remove();
  stack.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; setTimeout(() => el.remove(), 320); }, ms);
}

export function openModal({ title, body, actions = [] }) {
  const root = document.getElementById('modalRoot');
  root.hidden = false;
  root.innerHTML = `
    <div class="modal">
      <div class="modal-head"><h3></h3><button class="icon-btn" style="color:var(--ink-2)">×</button></div>
      <div class="modal-body"></div>
      ${actions.length ? '<div class="modal-foot"></div>' : ''}
    </div>`;
  root.querySelector('.modal-head h3').textContent = title;
  const bodyEl = root.querySelector('.modal-body');
  if (typeof body === 'string') bodyEl.innerHTML = body; else bodyEl.appendChild(body);
  const foot = root.querySelector('.modal-foot');
  actions.forEach((a) => {
    const btn = document.createElement('button');
    btn.className = `btn ${a.kind || 'ghost'}`;
    btn.textContent = a.label;
    btn.onclick = async () => {
      if (a.onClick) await a.onClick(btn);
      if (!a.keepOpen) closeModal();
    };
    foot.appendChild(btn);
  });
  root.querySelector('.modal-head .icon-btn').onclick = closeModal;
  root.onclick = (e) => { if (e.target === root) closeModal(); };
  return { bodyEl, close: closeModal };
}

export function closeModal() {
  const root = document.getElementById('modalRoot');
  root.hidden = true;
  root.innerHTML = '';
}

// --- formatting ------------------------------------------------------------
export const fmtTime = (iso) => iso ? new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '—';
export const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—';
export const fmtDateTime = (iso) => iso ? `${fmtDate(iso)} ${fmtTime(iso)}` : '—';
export const etaText = (mins) => {
  if (mins == null) return '—';
  if (mins < 1) return '<1 min';
  if (mins < 60) return `~${Math.round(mins)} min`;
  const h = Math.floor(mins / 60);
  return `~${h}h ${Math.round(mins % 60)}m`;
};
export const initials = (name = '?') => name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
export const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

export function statusBadge(status) {
  const map = {
    waiting: ['badge accent', 'Waiting'],
    called: ['badge gold', 'Called'],
    served: ['badge success', 'Served'],
    cancelled: ['badge grey', 'Cancelled'],
    'no-show': ['badge danger', 'No-show'],
  };
  const [cls, label] = map[status] || ['badge grey', status];
  return `<span class="${cls}">${label}</span>`;
}

export function stars(rating, size = '') {
  const full = '★';
  let out = '';
  for (let i = 1; i <= 5; i += 1) out += `<span class="${i <= rating ? '' : 'off'}">${full}</span>`;
  return `<span class="stars ${size}">${out}</span>`;
}

// --- SVG chart helpers -------------------------------------------------------
export function barChart({ data, labels, height = 180, color = 'var(--brand)', altColor = 'var(--accent)', series2 }) {
  const w = 560, h = height, padL = 34, padB = 24, padT = 12;
  const max = Math.max(1, ...data, ...(series2 || []));
  const bw = (w - padL - 10) / data.length;
  let bars = '';
  data.forEach((v, i) => {
    const x = padL + i * bw + bw * 0.18;
    const bh = ((h - padB - padT) * v) / max;
    bars += `<rect class="bar" x="${x.toFixed(1)}" y="${(h - padB - bh).toFixed(1)}" width="${(bw * 0.64).toFixed(1)}" height="${bh.toFixed(1)}" rx="3" fill="${color}"><title>${labels[i]}: ${v}</title></rect>`;
    if (series2) {
      const bh2 = ((h - padB - padT) * series2[i]) / max;
      bars += `<rect class="bar alt" x="${(x + bw * 0.22).toFixed(1)}" y="${(h - padB - bh2).toFixed(1)}" width="${(bw * 0.3).toFixed(1)}" height="${bh2.toFixed(1)}" rx="3" fill="${altColor}"><title>${labels[i]} (served): ${series2[i]}</title></rect>`;
    }
    bars += `<text class="label" x="${(padL + i * bw + bw / 2).toFixed(1)}" y="${h - 8}" text-anchor="middle">${labels[i]}</text>`;
  });
  // grid lines
  let grid = '';
  for (let g = 0; g <= 3; g += 1) {
    const y = padT + ((h - padB - padT) * g) / 3;
    grid += `<line class="grid-line" x1="${padL}" y1="${y}" x2="${w - 6}" y2="${y}"/>
             <text class="label" x="${padL - 6}" y="${y + 3}" text-anchor="end">${Math.round(max * (1 - g / 3))}</text>`;
  }
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img">${grid}${bars}</svg>`;
}

export function lineChart({ series, labels, height = 180, color = 'var(--brand)' }) {
  const w = 560, h = height, padL = 34, padB = 24, padT = 12;
  const flat = series.flat();
  const max = Math.max(1, ...flat);
  const n = labels.length;
  const x = (i) => padL + (i * (w - padL - 12)) / Math.max(1, n - 1);
  const y = (v) => h - padB - ((h - padB - padT) * v) / max;
  const pts = series.map((s) => s.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')).join(' ');
  let paths = '';
  series.forEach((s, si) => {
    const d = s.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    paths += `<path d="${d}" fill="none" stroke="${si === 0 ? color : 'var(--accent)'}" stroke-width="2.2"/>`;
    s.forEach((v, i) => {
      paths += `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="2.6" fill="${si === 0 ? color : 'var(--accent)'}"><title>${labels[i]}: ${v}</title></circle>`;
    });
  });
  let grid = '';
  for (let g = 0; g <= 3; g += 1) {
    const yy = padT + ((h - padB - padT) * g) / 3;
    grid += `<line class="grid-line" x1="${padL}" y1="${yy}" x2="${w - 6}" y2="${yy}"/>
             <text class="label" x="${padL - 6}" y="${yy + 3}" text-anchor="end">${Math.round(max * (1 - g / 3))}</text>`;
  }
  const labelEvery = Math.ceil(n / 7);
  let xlabels = '';
  labels.forEach((l, i) => {
    if (i % labelEvery === 0) xlabels += `<text class="label" x="${x(i).toFixed(1)}" y="${h - 8}" text-anchor="middle">${l}</text>`;
  });
  return `<svg class="chart" viewBox="0 0 ${w} ${h}">${grid}${paths}${xlabels}</svg>`;
}

export function donut({ parts, height = 180 }) {
  // parts: [{label, value, color}]
  const total = parts.reduce((a, p) => a + p.value, 0) || 1;
  const r = 62, cx = 90, cy = 90, sw = 22;
  const C = 2 * Math.PI * r;
  let offset = 0;
  let arcs = '';
  for (const p of parts) {
    const frac = p.value / total;
    if (frac <= 0) continue;
    arcs += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${p.color}" stroke-width="${sw}"
      stroke-dasharray="${(frac * C).toFixed(2)} ${C.toFixed(2)}" stroke-dashoffset="${(-offset * C).toFixed(2)}"
      transform="rotate(-90 ${cx} ${cy})"><title>${p.label}: ${p.value}</title></circle>`;
    offset += frac;
  }
  const legend = parts.map((p) => `
    <div class="flex" style="gap:8px;font-size:12.5px;padding:3px 0">
      <span style="width:11px;height:11px;border-radius:3px;background:${p.color};display:inline-block"></span>
      <span class="muted" style="flex:1">${p.label}</span><b>${p.value}</b>
    </div>`).join('');
  return `<div class="flex" style="gap:18px">
    <svg class="chart" viewBox="0 0 180 180" style="max-width:180px">${arcs}
      <text class="donut-center" x="${cx}" y="${cy - 2}" text-anchor="middle" font-size="22">${total}</text>
      <text class="label" x="${cx}" y="${cy + 15}" text-anchor="middle">total</text>
    </svg>
    <div style="flex:1;min-width:140px">${legend}</div>
  </div>`;
}

export function heatmapGrid({ data, days, height = 200 }) {
  // data: 7 x 24 arrivals; days: labels for rows (0=Sun)
  const w = 560, labelW = 44, top = 20, cellW = (w - labelW - 8) / 24, cellH = (height - top - 8) / 7;
  const max = Math.max(1, ...data.flat());
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  // order rows Mon..Sun
  const order = [1, 2, 3, 4, 5, 6, 0];
  let cells = '';
  order.forEach((dow, ri) => {
    cells += `<text class="label" x="${labelW - 8}" y="${top + ri * cellH + cellH / 2 + 3}" text-anchor="end">${dayNames[dow]}</text>`;
    for (let h = 0; h < 24; h += 1) {
      const v = data[dow][h];
      const intensity = v / max;
      const color = v === 0 ? '#eef1f6' : `rgba(220,0,6,${0.15 + intensity * 0.85})`;
      cells += `<rect x="${labelW + h * cellW}" y="${top + ri * cellH}" width="${cellW - 1.5}" height="${cellH - 1.5}" rx="2.5" fill="${color}">
        <title>${dayNames[dow]} ${h}:00 — ${v} arrivals</title></rect>`;
    }
  });
  let hours = '';
  for (let h = 0; h < 24; h += 3) {
    hours += `<text class="label" x="${labelW + h * cellW + cellW / 2}" y="${top - 6}" text-anchor="middle">${h}:00</text>`;
  }
  return `<svg class="chart" viewBox="0 0 ${w} ${height}">${hours}${cells}</svg>`;
}

export function escapeHtml(s = '') {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
