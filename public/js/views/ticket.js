// Single ticket detail with live position + QR code
import { api, socket } from '../api.js';
import { toast, etaText, fmtTime, fmtDateTime, statusBadge, escapeHtml } from '../ui.js';

export async function renderTicket(view, ticketId) {
  if (!api.user) { location.hash = '#/login'; return; }
  view.innerHTML = `<div class="spinner"></div>`;

  const data = await api.get(`/api/tickets/${ticketId}`).catch(() => null);
  if (!data) {
    view.innerHTML = `<div class="empty"><div class="e-icon">🎫</div><h3>Ticket not found</h3><p class="muted">It may have been removed.</p></div>`;
    return;
  }
  const { ticket, counter, feedback } = data;
  const qrUrl = `/api/services/${ticket.serviceId}/qr/${ticket._id}`;

  const paint = () => {
    const pos = ticket.position || 0;
    const pct = ticket.status === 'called' ? 100 : Math.max(6, 100 - (pos - 1) * 14);
    view.innerHTML = `
      <div class="page-head-row">
        <div class="page-head"><h1>Ticket <span class="mono">${escapeHtml(ticket.code)}</span></h1>
          <div class="sub">${escapeHtml(ticket.serviceName)} · ${escapeHtml(ticket.building)}</div>
        </div>
        <div class="flex">${statusBadge(ticket.status)}
          ${ticket.priority === 'high' ? '<span class="badge gold">⭐ Priority</span>' : ''}</div>
      </div>

      <div class="grid cols-2" style="max-width:920px">
        <div class="card ticket-hero">
          <div class="small muted uppercase" style="letter-spacing:.08em;font-weight:700">${ticket.status === 'called' ? 'Now serving' : 'Queue position'}</div>
          ${ticket.status === 'called'
            ? `<div class="big-code">${escapeHtml(ticket.counterName || counter || '')}</div>
               <p class="muted">Please go to the counter now</p>`
            : `<div class="big-code">#${pos}</div>
               <p class="muted">${pos <= 1 ? 'You are next!' : `${pos - 1} ${pos - 1 === 1 ? 'person' : 'people'} ahead of you`}</p>`}
          <div class="progress" style="max-width:340px;margin:10px auto"><i class="brand" style="width:${pct}%"></i></div>
          <div class="eta-box">
            <div class="sc-stat"><b class="mono">${ticket.status === 'called' ? 'NOW' : etaText(ticket.etaMinutes)}</b><span>Estimated</span></div>
            <div class="sc-stat"><b class="mono">${fmtTime(ticket.createdAt)}</b><span>Booked at</span></div>
            ${ticket.waitMinutes != null ? `<div class="sc-stat"><b class="mono">${ticket.waitMinutes}m</b><span>Waited</span></div>` : ''}
          </div>
          <img class="qr" src="${qrUrl}" alt="Ticket QR code" />
          <p class="small muted">Show this QR at the service desk</p>
          <div class="flex" style="gap:8px;justify-content:center;flex-wrap:wrap;margin-top:10px">
            <a class="btn ghost sm" href="#/portal">← My tickets</a>
            ${ticket.status === 'waiting' ? `<button class="btn danger-ghost sm" id="cancelBtn">Cancel ticket</button>` : ''}
          </div>
        </div>

        <div>
          <div class="card card-pad">
            <h3 class="card-title">Ticket timeline</h3>
            ${timeline(ticket)}
          </div>
          ${ticket.status === 'served' && !feedback ? `
            <div class="card card-pad section-gap" style="text-align:center">
              <h3 class="card-title">How was your visit?</h3>
              <a class="btn accent" href="#/feedback/${ticket._id}">Leave feedback ✍️</a>
            </div>` : ''}
          ${feedback ? `
            <div class="card card-pad section-gap">
              <h3 class="card-title">Your feedback</h3>
              <div class="stars">${'★'.repeat(feedback.rating)}<span class="off">${'★'.repeat(5 - feedback.rating)}</span></div>
              ${feedback.comment ? `<p class="muted small" style="margin-top:6px">"${escapeHtml(feedback.comment)}"</p>` : ''}
            </div>` : ''}
        </div>
      </div>`;

    const cancelBtn = view.querySelector('#cancelBtn');
    if (cancelBtn) cancelBtn.onclick = async () => {
      try {
        await api.post(`/api/tickets/${ticket._id}/cancel`);
        toast('Ticket cancelled', '', 'success');
        renderTicket(view, ticketId);
      } catch (err) { toast('Cancel failed', err.message, 'error'); }
    };
  };

  function timeline(t) {
    const steps = [
      { label: 'Booked', at: t.createdAt, done: true },
      { label: 'Called to counter', at: t.calledAt, done: !!t.calledAt },
      { label: 'Service completed', at: t.servedAt, done: !!t.servedAt },
    ];
    return `<div>${steps.map((s, i) => `
      <div class="flex" style="gap:12px;padding:8px 0">
        <span style="width:22px;height:22px;border-radius:50%;display:grid;place-items:center;font-size:11px;
          background:${s.done ? 'var(--success)' : '#e8ecf4'};color:#fff">${s.done ? '✓' : i + 1}</span>
        <div style="flex:1"><b class="small">${s.label}</b><div class="small muted">${s.at ? fmtDateTime(s.at) : 'Pending'}</div></div>
      </div>`).join('')}</div>`;
  }

  paint();

  // live updates for this ticket
  const update = (data) => {
    if (data && data._id === ticketId) {
      Object.assign(ticket, data);
      paint();
    }
  };
  socket.on('ticket:called', update);
  socket.on('ticket:served', update);
  socket.on('ticket:noshow', update);
  socket.on('ticket:cancelled', update);
  socket.emit('subscribe', `ticket:${ticketId}`);
  return () => {
    socket.off('ticket:called', update);
    socket.off('ticket:served', update);
    socket.off('ticket:noshow', update);
    socket.off('ticket:cancelled', update);
    socket.emit('unsubscribe', `ticket:${ticketId}`);
  };
}
