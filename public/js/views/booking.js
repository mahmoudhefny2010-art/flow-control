// Booking flow: pick a service -> confirm -> ticket with QR
import { api } from '../api.js';
import { toast, etaText, escapeHtml, initials } from '../ui.js';

export async function renderBooking(view, params) {
  const serviceId = params.get('service');
  if (!api.user) { location.hash = `#/login?redirect=${encodeURIComponent('#/portal/book')}`; return; }

  if (!serviceId) {
    // service picker
    view.innerHTML = `<div class="spinner"></div>`;
    const { services } = await api.get('/api/services').catch(() => ({ services: [] }));
    view.innerHTML = `
      <div class="page-head"><h1>Book a virtual queue ticket</h1><div class="sub">Choose a service</div></div>
      <div class="grid cols-3">
        ${services.map((s) => `
          <a class="card service-card" href="#/book/${s._id}" style="text-decoration:none;color:inherit">
            <div class="sc-head">
              <div><h4>${escapeHtml(s.name)}</h4><div class="sc-meta">${escapeHtml(s.building)}${s.floor ? ' · Floor ' + escapeHtml(String(s.floor)) : ''}</div></div>
            </div>
            <p class="small muted" style="margin:0">${escapeHtml(s.description || '')}</p>
            <div class="sc-stats">
              <div class="sc-stat"><b class="mono">${s.waiting}</b><span>Waiting</span></div>
              <div class="sc-stat"><b class="mono">${etaText(Math.round(s.avgWaitMinutesToday || s.avgServiceMinutes))}</b><span>Est. wait</span></div>
              <div class="sc-stat"><b class="mono">~${s.avgServiceMinutes}m</b><span>Service</span></div>
            </div>
          </a>`).join('')}
      </div>`;
    return;
  }

  const data = await api.get(`/api/services/${serviceId}`).catch(() => null);
  if (!data) {
    view.innerHTML = `<div class="empty"><div class="e-icon">🚫</div><h3>Service not found</h3><p class="muted">It may be inactive right now.</p></div>`;
    return;
  }
  const { service, counters } = data;
  const openCounters = counters.filter((c) => c.status === 'open');

  view.innerHTML = `
    <div class="page-head"><h1>Book: ${escapeHtml(service.name)}</h1>
      <div class="sub">${escapeHtml(service.building)}${service.floor ? ` · Floor ${escapeHtml(String(service.floor))}` : ''}${service.room ? ` · Room ${escapeHtml(service.room)}` : ''}</div>
    </div>

    <div class="grid cols-2" style="max-width:900px">
      <div class="card card-pad">
        <h3 class="card-title">Service details</h3>
        <p class="muted small">${escapeHtml(service.description || 'No description provided.')}</p>
        <div class="table-wrap"><table class="table">
          <tr><td class="muted">Average service time</td><td><b>~${service.avgServiceMinutes} min</b></td></tr>
          <tr><td class="muted">Open counters</td><td><b>${openCounters.length}</b> ${openCounters.map((c) => escapeHtml(c.name)).join(', ')}</td></tr>
          <tr><td class="muted">Priority lane</td><td>${service.priorityEnabled ? '<span class="badge gold">⭐ Enabled</span>' : '<span class="badge grey">Disabled</span>'}</td></tr>
        </table></div>
      </div>

      <div class="card card-pad">
        <h3 class="card-title">Your booking</h3>
        <form id="bookForm">
          ${service.priorityEnabled ? `
            <div class="field">
              <label>Queue type</label>
              <div class="form-row" style="gap:8px">
                <label class="flex" style="border:1.5px solid var(--line);border-radius:10px;padding:10px 12px;cursor:pointer;flex:1">
                  <input type="radio" name="priority" value="normal" checked /> Standard
                </label>
                <label class="flex" style="border:1.5px solid var(--gold);border-radius:10px;padding:10px 12px;cursor:pointer;flex:1;background:var(--gold-soft)">
                  <input type="radio" name="priority" value="high" /> ⭐ Priority
                </label>
              </div>
              <div class="small muted" style="margin-top:4px">Priority is for faculty, staff & accessibility needs. Priority tickets jump ahead fairly.</div>
            </div>` : `<input type="hidden" name="priority" value="normal" />`}
          <div class="field">
            <label for="note">Note for the desk (optional)</label>
            <input class="input" id="note" maxlength="300" placeholder="e.g. transcript request, student ID MIU-..." />
          </div>
          <div class="form-error" id="formError" hidden></div>
          <button class="btn primary btn-block lg" type="submit">Join the queue 🎫</button>
        </form>
      </div>
    </div>`;

  view.querySelector('#bookForm').onsubmit = async (e) => {
    e.preventDefault();
    const errEl = view.querySelector('#formError');
    errEl.hidden = true;
    const priority = service.priorityEnabled
      ? (new FormData(e.target).get('priority') || 'normal')
      : 'normal';
    const note = view.querySelector('#note').value.trim();
    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true;
    btn.textContent = 'Joining…';
    try {
      const { ticket } = await api.post(`/api/services/${serviceId}/book`, { priority, note });
      toast('Ticket booked 🎉', `${ticket.code} — position #${ticket.position}`, 'success');
      location.hash = `#/ticket/${ticket._id}`;
    } catch (err) {
      if (err.status === 409 && err.message.includes('active ticket')) {
        location.hash = '#/portal';
        return;
      }
      errEl.textContent = err.message;
      errEl.hidden = false;
      btn.disabled = false;
      btn.textContent = 'Join the queue 🎫';
    }
  };
}
