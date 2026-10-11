// Booking flow: pick a service -> confirm -> ticket with QR
import { api } from '../api.js';
import { toast, etaText, escapeHtml, initials } from '../ui.js';

export async function renderBooking(view, params) {
  const serviceId = params.get('service');
  if (!api.user) {
    const redirect = serviceId ? `#/book/${serviceId}` : '#/portal/book';
    location.hash = `#/login?redirect=${encodeURIComponent(redirect)}`;
    return;
  }

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
              <div class="sc-stat"><b class="mono">${etaText(s.estimatedWaitMinutes)}</b><span>Est. wait</span></div>
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
          ${service.code === 'REG' ? `
            <div class="registrar-intake">
              <h4>Newcomer details</h4>
              <div class="alert-banner" role="note"><strong>Important:</strong> Bookings are for today only, 8:00 AM–3:00 PM. You must arrive and complete entrance check-in by 3:00 PM on your appointment day. A booking or QR code does not keep a room open after closing; late arrivals cannot be checked in.</div>
              <div class="form-row">
                <div class="field"><label>Student name</label><input class="input" value="${escapeHtml(api.user.name || '')}" readonly /></div>
                <div class="field"><label>MIU ID</label><input class="input" value="${escapeHtml(api.user.studentId || '')}" readonly /></div>
              </div>
              <div class="field"><label>University email</label><input class="input" value="${escapeHtml(api.user.email || '')}" readonly /></div>
              <div class="field"><label for="studentPhone">Phone number</label><input class="input" id="studentPhone" type="tel" maxlength="20" value="${escapeHtml(api.user.phone || '')}" placeholder="01xxxxxxxxx" required /></div>
              <div class="form-row">
                <div class="field"><label for="appointmentDate">Appointment date</label><input class="input" id="appointmentDate" type="date" required /></div>
                <div class="field"><label for="timeSlot">Available time</label><select class="select" id="timeSlot" required disabled><option value="">Choose a date first</option></select></div>
              </div>
              <div class="field"><label for="major">Major</label><input class="input" id="major" maxlength="100" placeholder="Your accepted major" required /></div>
              <div class="field"><label for="certificateType">High-school certificate</label>
                <select class="select" id="certificateType" required>
                  <option value="">Choose certificate type</option>
                  <option value="general">Thanaweya Amma</option>
                  <option value="american">American Diploma</option>
                  <option value="ig">IG / IGCSE</option>
                  <option value="foreign">Other foreign certificate</option>
                </select>
                <div class="room-assignment-hint" id="roomAssignmentHint">Choose a certificate to see your room.</div>
              </div>
              <div class="form-row">
                <div class="field"><label for="paymentStatus">Payment status</label><select class="select" id="paymentStatus" required><option value="paid">Paid</option><option value="pending">Will complete payment</option></select></div>
                <div class="field"><label for="documentsStatus">Admission papers</label><select class="select" id="documentsStatus" required><option value="complete">Documents complete</option><option value="pending">Will complete documents</option></select></div>
              </div>
              <small class="registrar-disclaimer">The Registrar team can review these details when you arrive.</small>
            </div>` : ''}
          ${service.priorityEnabled && service.code !== 'REG' ? `
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

  const certificateType = view.querySelector('#certificateType');
  if (certificateType) {
    const updateRoomHint = () => {
      const room = certificateType.value ? (certificateType.value === 'general' ? 'OOB' : 'OO7') : '';
      view.querySelector('#roomAssignmentHint').textContent = room
        ? `Suggested room: ${room}. The entrance usher confirms the room.`
        : 'Choose a certificate to see your room.';
    };
    certificateType.addEventListener('change', updateRoomHint);
  }

  const appointmentDate = view.querySelector('#appointmentDate');
  const timeSlot = view.querySelector('#timeSlot');
  if (appointmentDate && timeSlot) {
    const today = new Date();
    const toDateInput = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    appointmentDate.min = toDateInput(today);
    appointmentDate.max = toDateInput(today);
    appointmentDate.value = toDateInput(today);
    appointmentDate.dispatchEvent(new Event('change'));
    appointmentDate.addEventListener('change', async () => {
      timeSlot.disabled = true;
      timeSlot.innerHTML = '<option value="">Loading times…</option>';
      try {
        const { slots, bookingOpen, closedDay, message } = await api.get(`/api/services/${serviceId}/slots?date=${encodeURIComponent(appointmentDate.value)}`);
        const available = slots.filter((slot) => slot.available);
        timeSlot.innerHTML = `<option value="">Choose a time</option>${available.map((slot) => `<option value="${slot.time}">${slot.time} · ${slot.capacity - slot.booked} spots</option>`).join('')}`;
        timeSlot.disabled = !bookingOpen || !available.length;
        if (!available.length) timeSlot.innerHTML = `<option value="">${escapeHtml(message || (closedDay ? 'Closed today' : bookingOpen ? 'No times available today' : 'Online booking opens at 8:00 AM and closes at 3:00 PM'))}</option>`;
      } catch (error) {
        timeSlot.innerHTML = `<option value="">${escapeHtml(error.message)}</option>`;
      }
    });
  }

  view.querySelector('#bookForm').onsubmit = async (e) => {
    e.preventDefault();
    const errEl = view.querySelector('#formError');
    errEl.hidden = true;
    const priority = service.priorityEnabled
      ? (new FormData(e.target).get('priority') || 'normal')
      : 'normal';
    const note = view.querySelector('#note').value.trim();
    const registrarProfile = service.code === 'REG' ? {
      major: view.querySelector('#major').value.trim(),
      certificateType: view.querySelector('#certificateType').value,
      paymentStatus: view.querySelector('#paymentStatus').value,
      documentsStatus: view.querySelector('#documentsStatus').value,
      phone: view.querySelector('#studentPhone').value.trim(),
      appointmentDate: view.querySelector('#appointmentDate').value,
      timeSlot: view.querySelector('#timeSlot').value,
    } : undefined;
    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true;
    btn.textContent = 'Joining…';
    try {
      const { ticket } = await api.post(`/api/services/${serviceId}/book`, { priority, note, ...(registrarProfile ? { registrarProfile } : {}) });
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
