// User portal: my tickets, live position, QR, service catalog
import { api, socket, subscribe, unsubscribe } from '../api.js';
import { toast, etaText, fmtTime, fmtDate, fmtDateTime, statusBadge, escapeHtml, openModal, initials } from '../ui.js';

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

  let active = tickets.filter((t) => t.status === 'waiting' || t.status === 'called');
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
      <div class="card portal-empty-state">
        <div class="portal-empty-icon" aria-hidden="true">🎫</div>
        <div><h3>No active tickets</h3><p class="muted">Choose an office to book your next visit.</p></div>
        <a class="btn primary" href="#/portal/book">Browse offices</a>
      </div>` : ''}

    <div class="grid cols-2" id="activeTickets" aria-live="polite">
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
    const nearTurn = t.status === 'waiting' && ((pos > 0 && pos <= 2) || (t.etaMinutes != null && Number(t.etaMinutes) <= 5));
    return `
      <div class="card card-pad" data-ticket="${t._id}">
        <div class="flex-between">
          <div>
            <span class="badge ${t.priority === 'high' ? 'gold' : 'accent'}">${t.priority === 'high' ? '⭐ Priority' : 'Standard'}</span>
            <h3 style="margin-top:8px" class="mono">${escapeHtml(t.code)}</h3>
            ${t.appointmentNumber ? `<div class="appointment-summary"><b>Appointment ${escapeHtml(t.appointmentNumber)}</b><span>${escapeHtml(t.appointmentDate || '')} · ${escapeHtml(t.timeSlot || '')} · Queue #${escapeHtml(String(t.queueNumber || '—'))}</span><span>${t.arrivalStatus === 'arrived' && t.roomCode ? `Assigned room ${escapeHtml(t.roomCode)}` : 'Room assigned at check-in'}</span><strong>Arrive and complete check-in by 3:00 PM on the appointment date. Late arrivals cannot be admitted.</strong></div>` : ''}
            <div class="muted small">${escapeHtml(t.serviceName)} · ${escapeHtml(t.building)}</div>
          </div>
          ${t.appointmentNumber ? `<span class="badge ${t.appointmentStatus === 'called' ? 'accent' : t.appointmentStatus === 'pending' ? 'warn' : t.appointmentStatus === 'completed' ? 'success' : 'grey'}">${escapeHtml(t.appointmentStatus || 'booked')}</span>` : statusBadge(t.status)}
        </div>
        ${t.status === 'waiting' ? `
          ${nearTurn ? `<div class="near-turn-banner" role="status" aria-live="polite"><span aria-hidden="true">🔔</span><div><strong>${pos === 1 ? "You're next — stay close" : 'Your turn is coming soon'}</strong><small>${pos === 1 ? 'Please stay near the office and watch for your call.' : `You’re #${pos}${t.etaMinutes != null ? ` · about ${etaText(t.etaMinutes)} left` : ' in line'}. Please get ready.`}</small></div></div>` : ''}
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
          <div class="sc-stat"><b class="mono">${etaText(s.estimatedWaitMinutes)}</b><span>Est. wait</span></div>
        </div>
        <div class="sc-meta small">Avg wait today: ${s.avgWaitSamples ? etaText(s.avgWaitMinutesToday) : 'Collecting data'}</div>
      </a>`;
  }

  const activeContainer = view.querySelector('#activeTickets');
  activeContainer?.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-cancel]');
    if (!btn) return;
    openModal({
      title: 'Cancel ticket?',
      body: '<p>Your position in the queue will be released. This cannot be undone.</p>',
      actions: [
        { label: 'Keep ticket', kind: 'ghost' },
        { label: 'Yes, cancel', kind: 'danger', onClick: async () => {
          try {
            await api.post(`/api/tickets/${btn.dataset.cancel}/cancel`);
            toast('Ticket cancelled', '', 'success');
            await refreshActiveTickets();
          } catch (err) { toast('Cancel failed', err.message, 'error'); }
        } },
      ],
    });
  });

  let refreshingTickets = false;
  async function refreshActiveTickets() {
    if (refreshingTickets) return;
    refreshingTickets = true;
    try {
      const data = await api.get('/api/tickets/mine');
      const latest = data.tickets || [];
      for (const next of latest) {
        const previous = tickets.find((ticket) => ticket._id === next._id);
        if (previous?.status === 'waiting' && previous.position > 2 && next.status === 'waiting' && next.position <= 2) {
          toast('Your turn is close', `${next.code}: you are #${next.position}. Please get ready.`, 'info');
        }
      }
      tickets = latest;
      active = tickets.filter((ticket) => ticket.status === 'waiting' || ticket.status === 'called');
      if (!activeContainer) return;
      activeContainer.innerHTML = active.length
        ? active.map(activeCard).join('')
        : '<div class="card card-pad" style="text-align:center;padding:36px 20px;grid-column:1/-1"><h3 style="margin:8px 0 4px">No active tickets</h3><p class="muted">Pick a service below to join the virtual queue.</p></div>';
    } catch { /* keep the last visible position when the network is unavailable */ }
    finally { refreshingTickets = false; }
  }

  const serviceRooms = [...new Set(services.map((service) => `service:${service._id}`))];
  if (serviceRooms.length) subscribe(...serviceRooms);
  let refreshingServices = false;
  async function refreshServiceEstimates() {
    if (refreshingServices) return;
    refreshingServices = true;
    try {
      const latest = await api.get('/api/services');
      services = latest.services || [];
      const grid = view.querySelector('#svcGrid');
      if (grid) grid.innerHTML = services.map(serviceMini).join('');
    } catch { /* keep the last live estimates visible during a brief outage */ }
    finally { refreshingServices = false; }
  }
  const handler = (snapshot) => {
    refreshServiceEstimates();
    if (active.some((ticket) => ticket.serviceId === snapshot?.service?._id)) refreshActiveTickets();
  };
  socket.on('queue:updated', handler);
  const serviceTimer = setInterval(refreshServiceEstimates, 30000);
  const appointmentUpdate = (event) => { toast('Appointment update', event?.message || 'Your appointment status changed.', 'info'); refreshActiveTickets(); };
  socket.on('appointment:updated', appointmentUpdate);
  const cleanup = () => {
    clearInterval(serviceTimer);
    socket.off('queue:updated', handler);
    socket.off('appointment:updated', appointmentUpdate);
    if (serviceRooms.length) unsubscribe(...serviceRooms);
  };
  return cleanup;
}
