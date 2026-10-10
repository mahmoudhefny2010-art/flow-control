// User portal: my tickets, live position, QR, service catalog
import { api, socket, subscribe, unsubscribe } from '../api.js';
import { toast, etaText, fmtTime, fmtDate, statusBadge, escapeHtml, openModal, initials } from '../ui.js';

export async function renderPortal(view) {
  if (!api.user) { location.hash = '#/login?redirect=%23%2Fportal'; return; }
  view.innerHTML = `<div class="spinner"></div>`;

  const [svcData, ticketData, notifData] = await Promise.all([
    api.get('/api/services').catch(() => ({ services: [] })),
    api.get('/api/tickets/mine').catch(() => ({ tickets: [] })),
    api.get('/api/notifications').catch(() => ({ notifications: [] })),
  ]);
  let { services } = svcData;
  let { tickets } = ticketData;
  const notifications = notifData.notifications || [];

  const active = tickets.filter((t) => t.status === 'waiting' || t.status === 'called');
  const history = tickets.filter((t) => t.status === 'served' || t.status === 'cancelled' || t.status === 'no-show');

  view.innerHTML = `
    <div class="page-head-row">
      <div class="page-head">
        <h1>Hello, ${escapeHtml(api.user.name.split(' ')[0])} 👋</h1>
        <div class="sub">Your virtual queue tickets and live positions</div>
      </div>
      <a class="btn primary" href="#/portal/book">+ New booking</a>
    </div>

    ${active.length === 0 ? `
      <div class="card card-pad" style="text-align:center;padding:44px 20px">
        <div style="font-size:40px">🎫</div>
        <h3 style="margin:8px 0 4px">No active tickets</h3>
        <p class="muted">Pick a service below to join the virtual queue.</p>
      </div>` : ''}

    <div class="grid cols-2" id="activeTickets">
      ${active.map(activeCard).join('')}
    </div>

    <div class="section-gap page-head-row">
      <div class="page-head"><h2>Browse services</h2><div class="sub">Join any queue with one tap</div></div>
    </div>
    <div class="grid cols-4" id="svcGrid">${services.map(serviceMini).join('')}</div>

    ${history.length ? `
      <div class="section-gap">
        <div class="card">
          <div class="card-pad" style="padding-bottom:0"><h3 class="card-title">Recent history</h3></div>
          <div class="table-wrap"><table class="table">
            <thead><tr><th>Ticket</th><th>Service</th><th>Booked</th><th>Wait</th><th>Status</th><th></th></tr></thead>
            <tbody>
              ${history.slice(0, 10).map((t) => `
                <tr>
                  <td><b class="mono">${escapeHtml(t.code)}</b></td>
                  <td>${escapeHtml(t.serviceName)}</td>
                  <td>${fmtDateTime(t.createdAt)}</td>
                  <td>${t.waitMinutes != null ? `${t.waitMinutes} min` : '—'}</td>
                  <td>${statusBadge(t.status)}</td>
                  <td>${t.status === 'served' && !t.feedback ? `<a class="btn sm accent" href="#/feedback/${t._id}">Rate ✍️</a>` : ''}</td>
                </tr>`).join('')}
            </tbody>
          </table></div>
        </div>
      </div>` : ''}

    ${notifications.length ? `
      <div class="section-gap">
        <div class="card">
          <div class="card-pad" style="padding-bottom:0"><h3 class="card-title">🔔 Notifications</h3></div>
          <div>${notifications.slice(0, 8).map((n) => `
            <div class="queue-item">
              <span style="font-size:18px">${n.type === 'inapp' ? '🔔' : '✉️'}</span>
              <div class="qi-main">
                <div class="qi-name">${escapeHtml(n.subject)}</div>
                <div class="qi-sub">${escapeHtml(n.text)}</div>
              </div>
              <small class="muted">${fmtTime(n.createdAt)}</small>
            </div>`).join('')}
          </div>
        </div>
      </div>` : ''}
  `;

  function activeCard(t) {
    const pos = t.position || 0;
    const pct = t.status === 'called' ? 100 : Math.max(6, 100 - (pos - 1) * 14);
    return `
      <div class="card card-pad" data-ticket="${t._id}">
        <div class="flex-between">
          <div>
            <span class="badge ${t.priority === 'high' ? 'gold' : 'accent'}">${t.priority === 'high' ? '⭐ Priority' : 'Standard'}</span>
            <h3 style="margin-top:8px" class="mono">${escapeHtml(t.code)}</h3>
            <div class="muted small">${escapeHtml(t.serviceName)} · ${escapeHtml(t.building)}</div>
          </div>
          ${statusBadge(t.status)}
        </div>
        ${t.status === 'waiting' ? `
          <div style="margin:16px 0 8px">
            <div class="flex-between" style="margin-bottom:6px">
              <span class="small muted">Your position</span>
              <b style="font-size:20px" class="mono">#${pos}</b>
            </div>
            <div class="progress"><i class="brand" style="width:${pct}%"></i></div>
            <div class="flex-between small muted" style="margin-top:6px">
              <span>${pluralWait(pos)} ahead</span>
              <span>Est. wait: <b class="mono">${etaText(t.etaMinutes)}</b></span>
            </div>
          </div>` : `
          <div class="alert-banner" style="margin-top:14px">
            <span style="font-size:18px">🔔</span>
            <div><b>You're being called!</b> Proceed to ${escapeHtml(t.counterName || 'your counter')} now.</div>
          </div>`}
        <div class="flex" style="gap:8px;margin-top:14px;flex-wrap:wrap">
          <a class="btn sm primary" href="#/ticket/${t._id}">🎟️ Ticket & QR</a>
          ${t.status === 'waiting' ? `<button class="btn sm danger-ghost" data-cancel="${t._id}">Cancel</button>` : ''}
        </div>
      </div>`;
  }

  function pluralWait(n) { return n <= 1 ? 'Almost there' : `${n - 1} ${n - 1 === 1 ? 'person' : 'people'}`; }

  function serviceMini(s) {
    const level = s.waiting === 0 ? 'success' : s.waiting < 8 ? 'warn' : 'danger';
    return `
      <a class="card service-card" href="#/book/${s._id}" style="text-decoration:none;color:inherit">
        <div class="sc-head">
          <div><h4>${escapeHtml(s.name)}</h4><div class="sc-meta">${escapeHtml(s.building)}</div></div>
          <span class="badge ${level}">${s.waiting === 0 ? 'No wait' : `${s.waiting} waiting`}</span>
        </div>
        <div class="sc-stats">
          <div class="sc-stat"><b class="mono">${s.waiting}</b><span>Queue</span></div>
          <div class="sc-stat"><b class="mono">${etaText(Math.round(s.avgWaitMinutesToday || s.avgServiceMinutes))}</b><span>Est. wait</span></div>
        </div>
      </a>`;
  }

  // cancel buttons
  view.querySelectorAll('[data-cancel]').forEach((btn) => {
    btn.onclick = () => {
      openModal({
        title: 'Cancel ticket?',
        body: '<p>Your position in the queue will be released. This cannot be undone.</p>',
        actions: [
          { label: 'Keep ticket', kind: 'ghost' },
          {
            label: 'Yes, cancel', kind: 'danger',
            onClick: async () => {
              try {
                await api.post(`/api/tickets/${btn.dataset.cancel}/cancel`);
                toast('Ticket cancelled', '', 'success');
                renderPortal(view);
              } catch (err) { toast('Cancel failed', err.message, 'error'); }
            },
          },
        ],
      });
    };
  });

  // live updates
  const handler = (data) => {
    const card = view.querySelector(`[data-ticket="${data._id}"]`);
    if (card) renderPortal(view);
    // refresh active ticket cards on any queue change
  };
  socket.on('ticket:called', handler);
  socket.on('ticket:served', handler);
  const cleanup = () => {
    socket.off('ticket:called', handler);
    socket.off('ticket:served', handler);
  };
  return cleanup;
}
