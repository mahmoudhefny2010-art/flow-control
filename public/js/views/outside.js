import { api } from '../api.js';
import { escapeHtml, toast } from '../ui.js';

const certificates = { general: 'Thanaweya Amma', american: 'American Diploma', ig: 'IG / IGCSE', foreign: 'Foreign certificate' };

export async function renderOutside(view) {
  if (!api.user) {
    location.hash = '#/login?redirect=%23%2Foutside';
    return;
  }
  if (!['outside-usher', 'admin'].includes(api.user.role)) { view.innerHTML = '<div class="empty"><h3>Outside usher access required</h3><p>Ask an administrator to assign this role to your account.</p></div>'; return; }
  let ticket = null;
  let stream = null;
  let scanning = false;
  view.innerHTML = `
    <div class="page-head"><span class="services-eyebrow">CAMPUS ENTRANCE</span><h1>Student check-in</h1><div class="sub">Scan the appointment QR, confirm the suggested room, and complete check-in.</div></div>
    <div class="outside-dashboard-grid">
      <section class="card card-pad">
        <h2>Scan appointment QR</h2><p class="muted small">Only signed appointment QR codes created by QueueFlow are accepted.</p>
        <button class="btn primary" id="outsideCamera" type="button">Open camera</button>
        <video id="outsideVideo" class="registrar-video" playsinline muted hidden></video>
        <form id="outsideManual" class="registrar-manual-scan"><label for="outsideQr">Or paste the QR text</label><div class="flex"><input class="input" id="outsideQr" placeholder="Paste the full QR content" required /><button class="btn accent" type="submit">Scan</button></div></form>
        <div class="divider"></div>
        <form id="outsideSearch"><label for="appointmentSearch">Search appointment</label><div class="flex"><input class="input" id="appointmentSearch" placeholder="Name, MIU ID, appointment or queue number" minlength="2" required /><button class="btn ghost" type="submit">Search</button></div></form>
        <div id="outsideSearchResults"></div>
      </section>
      <section class="card card-pad" id="outsideDetails"><div class="empty"><div class="e-icon">▦</div><h3>Ready to check in</h3><p>Scan a student's QR to review their appointment.</p></div></section>
    </div>`;

  view.insertAdjacentHTML('beforeend', `<section class="card card-pad walkin-card"><h2>Register a walk-in student</h2><p class="muted small">For a newcomer who arrived without an online booking. The ticket will be sent to the certificate's Registrar room.</p><form id="outsideWalkIn"><div class="form-row"><div class="field"><label>Student full name</label><input class="input" name="studentName" required minlength="2" maxlength="80"/></div><div class="field"><label>MIU ID / applicant ID</label><input class="input" name="studentId" required minlength="3" maxlength="30"/></div></div><div class="form-row"><div class="field"><label>Major</label><input class="input" name="major" required minlength="2" maxlength="100"/></div><div class="field"><label>Phone</label><input class="input" name="phone" type="tel" required minlength="8" maxlength="20"/></div></div><div class="form-row"><div class="field"><label>Certificate</label><select class="select" name="certificateType"><option value="general">Thanaweya Amma · OOB</option><option value="american">American Diploma · OO7</option><option value="ig">IG / IGCSE · OO7</option><option value="foreign">Other foreign certificate · OO7</option></select></div><div class="field"><label>Payment</label><select class="select" name="paymentStatus"><option value="paid">Paid</option><option value="pending">Pending</option></select></div><div class="field"><label>Admission papers</label><select class="select" name="documentsStatus"><option value="complete">Complete</option><option value="pending">Pending</option></select></div></div><button class="btn primary" type="submit">Create walk-in ticket</button></form><div id="walkinResult"></div></section>`);
  const details = view.querySelector('#outsideDetails');
  const loadTicket = async (qrValue) => {
    const result = await api.post('/api/registrar/scan', { qrValue }).catch((error) => ({ error }));
    if (result.error) { toast('QR not accepted', result.error.message, 'error'); return; }
    showTicket(result.ticket);
  };
  const showTicket = (value) => {
    ticket = value;
    const profile = value.registrarProfile || {};
    const suggestedRoom = value.roomCode || value.suggestedRoomCode || 'OOB';
    details.innerHTML = `
      <div class="flex-between"><div><span class="services-eyebrow">APPOINTMENT ${escapeHtml(value.appointmentNumber || value.code)}</span><h2>${escapeHtml(value.userName || 'Student')}</h2></div><span class="badge ${value.arrivalStatus === 'arrived' ? 'success' : 'warn'}">${value.arrivalStatus === 'arrived' ? 'Checked in' : 'Booked'}</span></div>
      <div class="registrar-student-details">
        <span><small>Student ID</small><b>${escapeHtml(profile.studentId || value.studentId || '—')}</b></span>
        <span><small>Queue number</small><b>${escapeHtml(value.code)}</b></span>
        <span><small>Certificate</small><b>${escapeHtml(certificates[profile.certificateType] || 'Not provided')}</b></span>
        <span><small>Major</small><b>${escapeHtml(profile.major || 'Not provided')}</b></span>
        <span><small>Appointment</small><b>${escapeHtml(value.appointmentDate || '—')} · ${escapeHtml(value.timeSlot || '—')}</b></span>
        <span><small>Phone</small><b>${escapeHtml(profile.phone || value.userPhone || '—')}</b></span>
        <span><small>Tuition</small><b>${profile.paymentStatus === 'paid' ? 'Student reports paid' : 'Student reports unpaid / pending'}</b></span>
        <span><small>Paperwork</small><b>${profile.documentsStatus === 'complete' ? 'Student reports complete' : 'Will complete during visit'}</b></span>
      </div>
      <div class="field"><label for="outsideRoom">Assign registrar room</label><select class="select" id="outsideRoom"><option value="OOB">Room OOB</option><option value="OO7">Room OO7</option></select><small class="registrar-disclaimer">Suggested by certificate: ${escapeHtml(suggestedRoom)}. Confirm or change it before check-in.</small></div>
      <button class="btn primary btn-block" id="completeCheckIn" ${value.arrivalStatus === 'arrived' ? 'disabled' : ''}>Complete check-in and assign room</button>`;
    details.querySelector('#outsideRoom').value = suggestedRoom;
    details.querySelector('#completeCheckIn').onclick = async () => {
      try {
        const { ticket: checkedIn } = await api.post('/api/registrar/check-in', { ticketId: ticket._id, roomCode: details.querySelector('#outsideRoom').value });
        toast('Check-in complete', `${checkedIn.code} assigned to room ${checkedIn.roomCode}`, 'success');
        showTicket(checkedIn);
      } catch (error) { toast('Check-in failed', error.message, 'error'); }
    };
  };
  view.querySelector('#outsideManual').onsubmit = async (event) => { event.preventDefault(); await loadTicket(view.querySelector('#outsideQr').value.trim()); };
  view.querySelector('#outsideSearch').onsubmit = async (event) => {
    event.preventDefault();
    const { appointments } = await api.get(`/api/registrar/search?q=${encodeURIComponent(view.querySelector('#appointmentSearch').value.trim())}`).catch(() => ({ appointments: [] }));
    view.querySelector('#outsideSearchResults').innerHTML = appointments.length ? appointments.map((item) => `<button class="outside-search-result" data-ticket-id="${escapeHtml(item._id)}"><b>${escapeHtml(item.userName)}</b><span>${escapeHtml(item.studentId || '')} · ${escapeHtml(item.appointmentNumber || item.code)} · ${escapeHtml(item.appointmentDate || '')} ${escapeHtml(item.timeSlot || '')}</span></button>`).join('') : '<p class="muted small">No active appointment found.</p>';
    view.querySelectorAll('[data-ticket-id]').forEach((button) => {
      button.onclick = async () => { try { await api.post(`/api/registrar/appointments/${button.dataset.ticketId}/prepare`, {}); const result = await api.get(`/api/registrar/appointments/${button.dataset.ticketId}`); showTicket(result.ticket); } catch (error) { toast('Could not verify appointment', error.message, 'error'); } };
    });
  };
  view.querySelector('#outsideWalkIn').onsubmit = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const now = new Date(); const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const minutes = Math.max(480, Math.ceil((now.getHours() * 60 + now.getMinutes()) / 30) * 30);
    const timeSlot = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
    try {
      const { services } = await api.get('/api/services'); const service = services.find((item) => item.code === 'REG');
      if (!service) throw new Error('Registrar service is not active');
      const { ticket: created } = await api.post(`/api/services/${service._id}/book`, { registrarProfile: { walkIn: true, studentName: form.get('studentName'), studentId: form.get('studentId'), major: form.get('major'), phone: form.get('phone'), certificateType: form.get('certificateType'), paymentStatus: form.get('paymentStatus'), documentsStatus: form.get('documentsStatus'), appointmentDate: date, timeSlot } });
      await api.post('/api/registrar/appointments/walk-in-check-in', { ticketId: created._id });
      toast('Walk-in registered', `${created.code} · ${created.userName} · room ${created.suggestedRoomCode}`, 'success');
      view.querySelector('#walkinResult').innerHTML = `<div class="appointment-summary"><b>${escapeHtml(created.code)} · ${escapeHtml(created.userName)}</b><span>MIU ID ${escapeHtml(created.studentId)} · Room ${escapeHtml(created.suggestedRoomCode)}</span></div>`;
      event.currentTarget.reset();
    } catch (error) { toast('Walk-in registration failed', error.message, 'error'); }
  };
  view.querySelector('#outsideCamera').onclick = async () => {
    if (!window.BarcodeDetector || !navigator.mediaDevices?.getUserMedia) { toast('Camera unavailable', 'Paste the full QR text or search the appointment.', 'warn'); return; }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } } });
      const video = view.querySelector('#outsideVideo'); video.srcObject = stream; video.hidden = false; await video.play();
      const detector = new BarcodeDetector({ formats: ['qr_code'] }); scanning = true;
      view.querySelector('#outsideCamera').textContent = 'Scanning…';
      while (scanning && video.isConnected) {
        const codes = await detector.detect(video).catch(() => []);
        if (codes.length) { scanning = false; view.querySelector('#outsideQr').value = codes[0].rawValue; await loadTicket(codes[0].rawValue); break; }
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    } catch (error) { toast('Camera could not start', error.message, 'error'); }
    finally { stopCamera(); }
  };
  function stopCamera() { scanning = false; stream?.getTracks().forEach((track) => track.stop()); stream = null; const video = view.querySelector('#outsideVideo'); if (video) { video.srcObject = null; video.hidden = true; } }
  return stopCamera;
}
