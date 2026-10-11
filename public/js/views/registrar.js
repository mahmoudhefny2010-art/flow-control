// Room-scoped registrar queue and appointment service controls.
import { api, socket, subscribe, unsubscribe } from '../api.js';
import { escapeHtml, toast } from '../ui.js';

const certificateLabels = { general: 'Thanaweya Amma', american: 'American Diploma', ig: 'IG / IGCSE', foreign: 'Foreign certificate' };
const paymentLabels = { paid: 'Student reports paid', pending: 'Payment pending' };
const documentLabels = { complete: 'Student reports complete', pending: 'Paperwork pending' };

export async function renderRegistrar(view) {
  if (!api.user) { location.hash = '#/login?redirect=%23%2Fregistrar'; return; }
  if (!['registrar-staff', 'admin'].includes(api.user.role)) { view.innerHTML = '<div class="empty"><h3>Registrar staff access required</h3><p>Ask an administrator to assign this role and room.</p></div>'; return; }
  let roomCode = api.user.roomCode || 'OOB';
  let roomData = null;
  view.innerHTML = '<div class="spinner"></div>';

  const paint = async () => {
    const result = await api.get(`/api/registrar/rooms/${roomCode}`).catch((error) => ({ error }));
    if (result.error) { view.innerHTML = `<div class="empty"><h3>Registrar room unavailable</h3><p>${escapeHtml(result.error.message)}</p></div>`; return; }
    roomData = result;
    const ordered = [...result.tickets].sort((a,b) => (a.queueNumber || 0) - (b.queueNumber || 0));
    const called = ordered.find((ticket) => ticket.status === 'called');
    const waiting = ordered.filter((ticket) => ticket.status === 'waiting');
    const ready = waiting.filter((ticket) => ticket.arrivalStatus === 'arrived').length;
    view.innerHTML = `
      <div class="page-head-row registrar-heading"><div class="page-head"><span class="services-eyebrow">REGISTRAR STAFF</span><h1>Room ${roomCode} dashboard</h1><div class="sub">Students must be checked in by 3:00 PM. Unchecked-in bookings do not keep this room open; finish serving anyone already checked in.</div></div>${api.user.role === 'admin' ? `<select class="select room-admin-select" id="roomChoice"><option>OOB</option><option>OO7</option></select>` : '<a class="btn ghost" href="#/room">Room usher view</a>'}</div>
      <div class="registrar-ops-toolbar"><div class="registrar-ops-stats"><span><b>${waiting.length}</b> booked / waiting</span><span><b>${ready}</b> checked in</span><span><b>${called ? 1 : 0}</b> being served</span></div><button class="btn primary" id="callNext" ${called || !ready ? 'disabled' : ''}>Call next checked-in student</button></div>
      ${called ? `<section class="card now-serving registrar-now-serving"><div><span class="ns-label">NOW SERVING Â· ${escapeHtml(called.code)}</span><div class="ns-code">${escapeHtml(called.userName)}</div><div class="ns-meta">${escapeHtml(called.registrarProfile?.major || '')} Â· ${escapeHtml(called.registrarProfile?.studentId || called.studentId || '')}</div></div><button class="btn accent" data-complete="${called._id}">Complete appointment</button></section>` : ''}
      <section class="card room-queue-card"><div class="card-pad"><h2>Today's appointment queue</h2><p class="muted small">Queue number is fixed at booking. Check in students by 3:00 PM; unchecked-in bookings do not hold the room open. Staff can finish serving students already checked in.</p></div>
      <div class="table-wrap"><table class="table"><thead><tr><th>Queue #</th><th>Student</th><th>Certificate</th><th>Major</th><th>Appointment</th><th>Arrival</th><th>Payment / papers</th><th>Status</th><th></th></tr></thead><tbody>
      ${ordered.map((ticket) => {
        const profile = ticket.registrarProfile || {};
        const state = ticket.status === 'called' ? 'Called' : ticket.appointmentStatus === 'pending' ? 'Pending' : ticket.arrivalStatus === 'arrived' ? 'Waiting' : 'Booked';
        const badge = state === 'Called' ? 'accent' : state === 'Pending' ? 'warn' : state === 'Waiting' ? 'success' : 'grey';
        return `<tr><td><b>${escapeHtml(ticket.code)}</b><div class="small muted">${escapeHtml(ticket.appointmentNumber || '')}</div></td><td>${escapeHtml(ticket.userName)}<div class="small muted">${escapeHtml(profile.studentId || ticket.studentId || '')}</div></td><td>${escapeHtml(certificateLabels[profile.certificateType] || 'â€”')}</td><td>${escapeHtml(profile.major || 'â€”')}</td><td>${escapeHtml(ticket.appointmentDate || 'â€”')} Â· ${escapeHtml(ticket.timeSlot || 'â€”')}</td><td>${escapeHtml(ticket.arrivedAt ? new Date(ticket.arrivedAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : 'Not checked in')}</td><td>${escapeHtml(paymentLabels[profile.paymentStatus] || 'â€”')}<div class="small muted">${escapeHtml(documentLabels[profile.documentsStatus] || 'â€”')} Â· student-reported</div></td><td><span class="badge ${badge}">${state}</span></td><td>${ticket.status === 'called' && api.user.role === 'admin' ? `<button class="btn sm danger-ghost" data-skip="${ticket._id}">Skip</button>` : ''}</td></tr>`;
      }).join('') || '<tr><td colspan="9" class="empty">No appointments in this room today.</td></tr>'}
      </tbody></table></div></section>`;
    const selector = view.querySelector('#roomChoice');
    if (selector) { selector.value = roomCode; selector.onchange = () => { leave(); roomCode = selector.value; paint().then(join); }; }
    view.querySelector('#callNext')?.addEventListener('click', async () => {
      try { const { ticket } = await api.post(`/api/registrar/rooms/${roomCode}/call-next`, {}); toast('Student called', `${ticket.code} Â· ${ticket.userName}`, 'success'); await paint(); }
      catch (error) { toast('Could not call next', error.message, 'warn'); await paint(); }
    });
    view.querySelectorAll('[data-complete]').forEach((button) => button.onclick = async () => {
      try { await api.post(`/api/registrar/rooms/${roomCode}/complete/${button.dataset.complete}`, {}); toast('Appointment completed', '', 'success'); await paint(); }
      catch (error) { toast('Could not complete appointment', error.message, 'error'); }
    });
    view.querySelectorAll('[data-skip]').forEach((button) => button.onclick = async () => {
      try { await api.post(`/api/registrar/rooms/${roomCode}/skip/${button.dataset.skip}`, {}); toast('Appointment skipped', 'The action was recorded.', 'warn'); await paint(); }
      catch (error) { toast('Could not skip appointment', error.message, 'error'); }
    });
  };
  const update = (event) => { if (event?.roomCode === roomCode) paint(); };
  const roomName = () => roomData?.service?._id ? `room:${roomData.service._id}:${roomCode}` : null;
  function join() { const room = roomName(); if (room) subscribe(room); socket.on('registrar:room-updated', update); }
  function leave() { const room = roomName(); if (room) unsubscribe(room); socket.off('registrar:room-updated', update); }
  await paint(); join();
  return leave;
}
