import { api, socket, subscribe, unsubscribe } from '../api.js';
import { escapeHtml, toast } from '../ui.js';

const certs = { general: 'Thanaweya Amma', american: 'American Diploma', ig: 'IG / IGCSE', foreign: 'Foreign' };

export async function renderRoom(view) {
  if (!api.user) { location.hash = '#/login?redirect=%23%2Froom'; return; }
  if (!['room-usher', 'registrar-staff', 'admin'].includes(api.user.role)) { view.innerHTML = '<div class="empty"><h3>Room usher access required</h3><p>Ask an administrator to assign this role and room.</p></div>'; return; }
  let roomCode = api.user.roomCode || 'OOB';
  let currentRoom = null;
  view.innerHTML = '<div class="spinner"></div>';
  const paint = async () => {
    const result = await api.get(`/api/registrar/rooms/${roomCode}`).catch((error) => ({ error }));
    if (result.error) { view.innerHTML = `<div class="empty"><h3>Room dashboard unavailable</h3><p>${escapeHtml(result.error.message)}</p></div>`; return; }
    currentRoom = result;
    const waiting = [...result.waiting].sort((a,b) => (a.queueNumber || 0) - (b.queueNumber || 0));
    const called = [...result.called];
    view.innerHTML = `
      <div class="page-head-row"><div class="page-head"><span class="services-eyebrow">ROOM USHER</span><h1>Room ${roomCode}</h1><div class="sub">Read-only appointment list and attendance assistance.</div></div>${api.user.role === 'admin' ? `<select class="select room-admin-select" id="roomChoice"><option>OOB</option><option>OO7</option></select>` : ''}</div>
      <div class="grid cols-3 room-kpis"><div class="card kpi"><div class="kpi-label">Booked today</div><div class="kpi-value">${waiting.length + called.length}</div></div><div class="card kpi"><div class="kpi-label">Checked in</div><div class="kpi-value">${waiting.filter(t => t.arrivalStatus === 'arrived').length + called.filter(t => t.arrivalStatus === 'arrived').length}</div></div><div class="card kpi"><div class="kpi-label">Waiting / called</div><div class="kpi-value">${waiting.length} / ${called.length}</div></div></div>
      <section class="card room-queue-card"><div class="card-pad"><h2>Today's appointments</h2><p class="muted small">Queue order follows booking number. Assist attendance when a student is physically at the room.</p><button class="btn primary" id="roomWalkInButton">Register walk-in student</button></div>
      <div class="table-wrap"><table class="table"><thead><tr><th>Queue</th><th>Student</th><th>Certificate / major</th><th>Appointment</th><th>Arrival</th><th>Status</th><th></th></tr></thead><tbody>
      ${[...called, ...waiting].map((t) => `<tr><td><b>${escapeHtml(t.code)}</b><div class="small muted">${escapeHtml(t.appointmentNumber || '')}</div></td><td>${escapeHtml(t.userName)}<div class="small muted">${escapeHtml(t.studentId || '')}</div></td><td>${escapeHtml(certs[t.registrarProfile?.certificateType] || '—')}<div class="small muted">${escapeHtml(t.registrarProfile?.major || '—')}</div></td><td>${escapeHtml(t.appointmentDate || '—')} ${escapeHtml(t.timeSlot || '')}</td><td>${escapeHtml(t.arrivedAt ? new Date(t.arrivedAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : 'Not checked in')}</td><td><span class="badge ${t.appointmentStatus === 'called' ? 'accent' : t.appointmentStatus === 'pending' ? 'warn' : t.arrivalStatus === 'arrived' ? 'success' : 'grey'}">${escapeHtml(t.appointmentStatus || 'booked')}</span></td><td>${t.arrivalStatus === 'arrived' ? '—' : `<button class="btn sm ghost" data-attendance="${t._id}">Assist attendance</button>`}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">No appointments for this room today.</td></tr>'}
      </tbody></table></div></section>`;
    const selector = view.querySelector('#roomChoice');
    if (selector) { selector.value = roomCode; selector.onchange = () => { leave(); roomCode = selector.value; paint().then(join); }; }
    view.querySelectorAll('[data-attendance]').forEach((button) => { button.onclick = async () => { try { await api.post(`/api/registrar/rooms/${roomCode}/attendance/${button.dataset.attendance}`, {}); toast('Attendance recorded', 'Student is checked in.', 'success'); await paint(); } catch (error) { toast('Could not update attendance', error.message, 'error'); } }; });
    view.querySelector('#roomWalkInButton').onclick = () => {
      if (view.querySelector('#roomWalkInForm')) { view.querySelector('#roomWalkInForm').remove(); return; }
      view.querySelector('.room-queue-card').insertAdjacentHTML('afterbegin', `<div class="card-pad" id="roomWalkInForm"><h3>Register walk-in student · Room ${roomCode}</h3><form><div class="form-row"><input class="input" name="studentName" placeholder="Full name" required/><input class="input" name="studentId" placeholder="MIU ID / applicant ID" required/><input class="input" name="major" placeholder="Major" required/></div><div class="form-row"><input class="input" name="phone" placeholder="Phone" required/><select class="select" name="certificateType">${roomCode === 'OOB' ? '<option value="general">Thanaweya Amma</option>' : '<option value="american">American Diploma</option><option value="ig">IG / IGCSE</option><option value="foreign">Other foreign certificate</option>'}</select><select class="select" name="paymentStatus"><option value="paid">Paid</option><option value="pending">Payment pending</option></select><select class="select" name="documentsStatus"><option value="complete">Papers complete</option><option value="pending">Papers pending</option></select></div><button class="btn primary" type="submit">Create and check in</button></form></div>`);
      view.querySelector('#roomWalkInForm form').onsubmit = async (event) => {
        event.preventDefault(); const form = new FormData(event.currentTarget); const now = new Date(); const date = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`; const mins = Math.max(480, Math.ceil((now.getHours()*60+now.getMinutes())/30)*30); const time = `${String(Math.floor(mins/60)).padStart(2,'0')}:${String(mins%60).padStart(2,'0')}`;
        try { const { services } = await api.get('/api/services'); const service = services.find((item) => item.code === 'REG'); if (!service) throw new Error('Registrar service is not active'); const { ticket } = await api.post(`/api/services/${service._id}/book`, { registrarProfile: { walkIn: true, studentName: form.get('studentName'), studentId: form.get('studentId'), major: form.get('major'), phone: form.get('phone'), certificateType: form.get('certificateType'), paymentStatus: form.get('paymentStatus'), documentsStatus: form.get('documentsStatus'), appointmentDate: date, timeSlot: time } }); await api.post('/api/registrar/appointments/walk-in-check-in', { ticketId: ticket._id }); toast('Walk-in added to room', `${ticket.code} · ${ticket.userName}`, 'success'); await paint(); } catch (error) { toast('Could not register walk-in', error.message, 'error'); }
      };
    };
  };
  const roomName = () => currentRoom?.service?._id ? `room:${currentRoom.service._id}:${roomCode}` : null;
  const update = (data) => { if (data?.roomCode === roomCode) paint(); };
  function join() { const room = roomName(); if (room) subscribe(room); socket.on('registrar:room-updated', update); }
  function leave() { const room = roomName(); if (room) unsubscribe(room); socket.off('registrar:room-updated', update); }
  await paint(); join();
  return leave;
}
