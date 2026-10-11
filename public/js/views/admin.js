// Admin dashboard: overview, services, counters, users, integration, notifications
import { api, socket } from '../api.js';
import { toast, fmtTime, fmtDate, fmtDateTime, statusBadge, escapeHtml, openModal, closeModal, barChart } from '../ui.js';

const TABS = [
  ['overview', '📊 Overview'],
  ['services', '🗂️ Services'],
  ['counters', '🖥️ Counters'],
  ['users', '👥 Users'],
  ['appointments', 'Registrar appointments'],
  ['booking', 'Booking schedule'],
  ['audit', 'Audit log'],
  ['integration', '🔗 Integration'],
  ['notifications', '🔔 Notifications'],
];

export async function renderAdmin(view, params) {
  if (!api.user || api.user.role !== 'admin') {
    location.hash = '#/login?redirect=%23%2Fadmin';
    return;
  }
  let tab = params.get('tab') || 'overview';
  if (!TABS.some(([id]) => id === tab)) tab = 'overview';

  view.innerHTML = `
    <div class="page-head-row">
      <div class="page-head"><h1>Admin Dashboard</h1>
        <div class="sub">Platform configuration & operations</div>
      </div>
    </div>
    <div class="tabs">
      ${TABS.map(([id, label]) => `<button class="tab ${id === tab ? 'active' : ''}" data-tab="${id}">${label}</button>`).join('')}
    </div>
    <div id="tabBody"><div class="spinner"></div></div>`;

  view.querySelectorAll('.tab').forEach((b) => {
    b.onclick = () => {
      view.querySelectorAll('.tab').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      tab = b.dataset.tab;
      renderTab();
    };
  });

  async function renderTab() {
    const body = document.getElementById('tabBody');
    body.innerHTML = '<div class="spinner"></div>';
    try {
      if (tab === 'overview') await renderOverview(body);
      else if (tab === 'services') await renderServices(body);
      else if (tab === 'counters') await renderCounters(body);
      else if (tab === 'users') await renderUsers(body);
      else if (tab === 'appointments') await renderAppointments(body);
      else if (tab === 'booking') await renderBookingSchedule(body);
      else if (tab === 'audit') await renderAudit(body);
      else if (tab === 'integration') await renderIntegration(body);
      else if (tab === 'notifications') await renderNotifications(body);
    } catch (err) {
      body.innerHTML = `<div class="alert-banner">⚠️ ${escapeHtml(err.message)}</div>`;
    }
  }

  // ---- Overview ------------------------------------------------------
  async function renderOverview(body) {
    const { today, week, services, users, counters, notifications } = await api.get('/api/admin/overview');
    const live = today.liveQueues || [];

    body.innerHTML = `
      <div class="grid cols-4">
        <div class="card kpi brand"><div class="kpi-label">Tickets today</div><div class="kpi-value mono">${today.totalTickets}</div><div class="kpi-sub">${today.served} served</div></div>
        <div class="card kpi accent"><div class="kpi-label">Avg wait today</div><div class="kpi-value mono">${today.avgWaitSamples ? today.avgWaitMinutes : '—'}<span style="font-size:14px"> min</span></div><div class="kpi-sub">${today.avgWaitSamples ? `Calculated from ${today.avgWaitSamples} completed visits` : 'No completed visits yet'}</div></div>
        <div class="card kpi gold"><div class="kpi-label">Avg service</div><div class="kpi-value mono">${today.avgServiceMinutes}<span style="font-size:14px"> min</span></div><div class="kpi-sub">7-day: ${week.avgServiceMinutes} min</div></div>
        <div class="card kpi danger"><div class="kpi-label">CSAT</div><div class="kpi-value mono">${today.csat || '—'}<span style="font-size:14px"> /5</span></div><div class="kpi-sub">${today.feedbackCount} ratings · ${today.responseRate}% response</div></div>
      </div>

      <div class="section-gap grid cols-2">
        <div class="card card-pad">
          <h3 class="card-title">Live queues</h3>
          ${live.map((q) => `
            <div class="queue-item" style="padding:9px 4px">
              <div class="qi-main">
                <div class="qi-name">${escapeHtml(q.name)}</div>
                <div class="qi-sub">${escapeHtml(q.building)}</div>
              </div>
              <span class="badge ${q.waiting >= 15 ? 'danger' : q.waiting >= 8 ? 'warn' : 'success'}">${q.waiting} waiting</span>
            </div>`).join('')}
        </div>
        <div class="card card-pad">
          <h3 class="card-title">Tickets by service (7 days)</h3>
          <div id="svcChart"><div class="spinner" style="margin:20px auto"></div></div>
        </div>
      </div>

      <div class="section-gap grid cols-2">
        <div class="card">
          <div class="card-pad" style="padding-bottom:0"><h3 class="card-title">Recent notifications</h3></div>
          ${notifications.slice(0, 6).map((n) => `
            <div class="queue-item" style="padding:9px 16px">
              <span>${n.channel === 'smtp' ? '✉️' : n.channel === 'inapp' ? '🔔' : '📝'}</span>
              <div class="qi-main"><div class="qi-name small">${escapeHtml(n.subject)}</div>
              <div class="qi-sub">${escapeHtml(n.to || '')}</div></div>
              <span class="badge ${n.status === 'sent' || n.status === 'delivered' ? 'success' : 'danger'}">${escapeHtml(n.status)}</span>
            </div>`).join('') || '<div class="empty">No notifications yet</div>'}
        </div>
        <div class="card card-pad">
          <h3 class="card-title">System</h3>
          <table class="table">
            <tr><td class="muted">Registered users</td><td><b>${users.length}</b> (showing latest ${users.length})</td></tr>
            <tr><td class="muted">Services</td><td><b>${services.length}</b></td></tr>
            <tr><td class="muted">Counters</td><td><b>${counters.length}</b> (${counters.filter((c) => c.status === 'open').length} open)</td></tr>
            <tr><td class="muted">Waiting now</td><td><b class="mono">${today.waitingNow}</b></td></tr>
            <tr><td class="muted">Realtime</td><td><span class="badge success">Socket.io connected</span></td></tr>
          </table>
        </div>
      </div>`;

    // service chart from per-service analytics
    try {
      const { services: svcStats } = await api.get('/api/analytics/services?days=7');
      const chartHost = document.getElementById('svcChart');
      if (chartHost) {
        chartHost.innerHTML = barChart({
          data: svcStats.map((s) => s.total),
          labels: svcStats.map((s) => s.code),
          series2: svcStats.map((s) => s.served),
        });
      }
    } catch { /* non-critical */ }
  }

  // ---- Services ------------------------------------------------------
  async function renderServices(body) {
    const { services } = await api.get('/api/admin/overview');
    body.innerHTML = `
      <div class="flex-between" style="margin-bottom:14px">
        <div class="muted small">${services.length} services configured</div>
        <button class="btn primary sm" id="addService">+ New service</button>
      </div>
      <div class="card"><div class="table-wrap"><table class="table">
        <thead><tr><th>Code</th><th>Name</th><th>Location</th><th>Avg</th><th>Priority</th><th>Status</th><th></th></tr></thead>
        <tbody>
          ${services.map((s) => `
            <tr>
              <td><b class="mono">${escapeHtml(s.code)}</b></td>
              <td>${escapeHtml(s.name)}<div class="small muted">${escapeHtml(s.category)}</div></td>
              <td>${escapeHtml(s.building)}${s.floor ? ` · ${escapeHtml(String(s.floor))}` : ''}</td>
              <td>~${s.avgServiceMinutes}m</td>
              <td>${s.priorityEnabled ? '<span class="badge gold">⭐</span>' : '—'}</td>
              <td>${s.active ? '<span class="badge success">Active</span>' : '<span class="badge grey">Inactive</span>'}</td>
              <td>
                <div class="flex" style="gap:6px">
                  <button class="btn sm ghost" data-edit="${s._id}">Edit</button>
                  <button class="btn sm danger-ghost" data-del="${s._id}">✕</button>
                </div>
              </td>
            </tr>`).join('')}
        </tbody>
      </table></div></div>`;

    const formModal = (svc) => {
      openModal({
        title: svc ? 'Edit service' : 'New service',
        body: `
          <form id="svcForm">
            <div class="form-row">
              <div class="field"><label>Name</label><input class="input" id="f-name" value="${escapeHtml(svc?.name || '')}" required /></div>
              <div class="field"><label>Code (2-5 chars)</label><input class="input" id="f-code" maxlength="5" value="${escapeHtml(svc?.code || '')}" placeholder="REG" required /></div>
            </div>
            <div class="form-row">
              <div class="field"><label>Category</label><input class="input" id="f-cat" value="${escapeHtml(svc?.category || '')}" placeholder="Academic" /></div>
              <div class="field"><label>Service duration baseline (min)</label><input class="input" id="f-avg" type="number" min="1" max="120" value="${svc?.avgServiceMinutes || 5}" /><small class="muted">Used per visit; average wait is calculated from queue activity.</small></div>
            </div>
            <div class="form-row">
              <div class="field"><label>Building</label><input class="input" id="f-bld" value="${escapeHtml(svc?.building || '')}" required /></div>
              <div class="field"><label>Floor / Room</label><input class="input" id="f-room" value="${escapeHtml(svc?.room || '')}" placeholder="1 / G-12" /></div>
            </div>
            <div class="field"><label>Description</label><textarea class="textarea" id="f-desc">${escapeHtml(svc?.description || '')}</textarea></div>
            <div class="form-row">
              <div class="field"><label>Map X (0-1000)</label><input class="input" id="f-x" type="number" min="0" max="1000" value="${svc?.map?.x ?? 500}" /></div>
              <div class="field"><label>Map Y (0-640)</label><input class="input" id="f-y" type="number" min="0" max="640" value="${svc?.map?.y ?? 300}" /></div>
            </div>
            <label class="flex small"><input type="checkbox" id="f-prio" ${svc?.priorityEnabled !== false ? 'checked' : ''} /> Priority lane enabled</label>
            ${svc ? `<label class="flex small"><input type="checkbox" id="f-active" ${svc.active ? 'checked' : ''} /> Active</label>` : ''}
            <div class="form-error" id="f-err" hidden></div>
          </form>`,
        actions: [
          { label: 'Cancel', kind: 'ghost' },
          {
            label: svc ? 'Save' : 'Create', kind: 'primary',
            onClick: async () => {
              const payload = {
                name: body.querySelector('#f-name').value.trim(),
                code: body.querySelector('#f-code').value.trim(),
                category: body.querySelector('#f-cat').value.trim(),
                avgServiceMinutes: parseInt(body.querySelector('#f-avg').value, 10) || 5,
                building: body.querySelector('#f-bld').value.trim(),
                room: body.querySelector('#f-room').value.trim(),
                description: body.querySelector('#f-desc').value.trim(),
                priorityEnabled: body.querySelector('#f-prio').checked,
                map: {
                  x: Math.min(1000, Math.max(0, parseInt(body.querySelector('#f-x').value, 10) || 500)),
                  y: Math.min(640, Math.max(0, parseInt(body.querySelector('#f-y').value, 10) || 300)),
                },
              };
              if (svc) payload.active = body.querySelector('#f-active').checked;
              try {
                if (svc) await api.put(`/api/admin/services/${svc._id}`, payload);
                else await api.post('/api/admin/services', payload);
                toast('Service saved', '', 'success');
                renderTab();
              } catch (err) {
                const errEl = document.getElementById('f-err');
                if (errEl) { errEl.textContent = err.message; errEl.hidden = false; }
                throw new Error('__keep__'); // keep modal open
              }
            },
          },
        ],
      });
    };

    body.querySelector('#addService').onclick = () => formModal(null);
    body.querySelectorAll('[data-edit]').forEach((b) => {
      b.onclick = () => formModal(services.find((s) => s._id === b.dataset.edit));
    });
    body.querySelectorAll('[data-del]').forEach((b) => {
      b.onclick = () => openModal({
        title: 'Delete service?',
        body: '<p>This also removes its counters. Historical tickets are kept.</p>',
        actions: [
          { label: 'Cancel', kind: 'ghost' },
          {
            label: 'Delete', kind: 'danger',
            onClick: async () => {
              await api.del(`/api/admin/services/${b.dataset.del}`);
              toast('Service deleted', '', 'warn');
              renderTab();
            },
          },
        ],
      });
    });
  }

  // ---- Counters ------------------------------------------------------
  async function renderCounters(body) {
    const { counters, services, users } = await api.get('/api/admin/overview');
    const employees = users.filter((u) => u.role === 'employee' || u.role === 'admin');

    body.innerHTML = `
      <div class="flex-between" style="margin-bottom:14px">
        <div class="muted small">${counters.length} counters · ${counters.filter((c) => c.status === 'open').length} open</div>
        <button class="btn primary sm" id="addCounter">+ New counter</button>
      </div>
      <div class="card"><div class="table-wrap"><table class="table">
        <thead><tr><th>Name</th><th>Service</th><th>Assigned to</th><th>Status</th><th></th></tr></thead>
        <tbody>
          ${counters.map((c) => {
            const svc = services.find((s) => s._id === c.serviceId);
            const emp = c.employeeId ? users.find((u) => u._id === c.employeeId) : null;
            return `
              <tr>
                <td><b>${escapeHtml(c.name)}</b></td>
                <td>${escapeHtml(svc?.name || '—')}</td>
                <td>${emp ? escapeHtml(emp.name) : '<span class="muted">Unassigned</span>'}</td>
                <td>${c.status === 'open' ? '<span class="badge success">Open</span>' : '<span class="badge grey">Closed</span>'}</td>
                <td>
                  <div class="flex" style="gap:6px">
                    <button class="btn sm ${c.status === 'open' ? 'ghost' : 'primary'}" data-toggle="${c._id}" data-status="${c.status}">${c.status === 'open' ? 'Close' : 'Open'}</button>
                    <button class="btn sm ghost" data-assign="${c._id}">Assign</button>
                  </div>
                </td>
              </tr>`;
          }).join('')}
        </tbody>
      </table></div></div>`;

    body.querySelector('#addCounter').onclick = () => {
      openModal({
        title: 'New counter',
        body: `
          <form id="ctrForm">
            <div class="field"><label>Name</label><input class="input" id="c-name" placeholder="e.g. REG Counter 3" required /></div>
            <div class="field"><label>Service</label>
              <select class="select" id="c-svc">${services.map((s) => `<option value="${s._id}">${escapeHtml(s.name)}</option>`).join('')}</select>
            </div>
            <div class="field"><label>Registrar room (required for Registrar)</label>
              <select class="select" id="c-room"><option value="">Not applicable</option><option value="OOB">OOB — General secondary</option><option value="OO7">OO7 — American, IG or foreign</option></select>
            </div>
            <div class="field"><label>Assign to (optional)</label>
              <select class="select" id="c-emp"><option value="">— unassigned —</option>${employees.map((e) => `<option value="${e._id}">${escapeHtml(e.name)}</option>`).join('')}</select>
            </div>
          </form>`,
        actions: [
          { label: 'Cancel', kind: 'ghost' },
          {
            label: 'Create', kind: 'primary',
            onClick: async () => {
              const name = document.getElementById('c-name').value.trim();
              if (!name) return;
              await api.post('/api/admin/counters', {
                name,
                serviceId: document.getElementById('c-svc').value,
                roomCode: document.getElementById('c-room').value || undefined,
                employeeId: document.getElementById('c-emp').value || null,
              });
              toast('Counter created', '', 'success');
              renderTab();
            },
          },
        ],
      });
    };

    body.querySelectorAll('[data-toggle]').forEach((b) => {
      b.onclick = async () => {
        const next = b.dataset.status === 'open' ? 'closed' : 'open';
        await api.put(`/api/admin/counters/${b.dataset.toggle}`, { status: next });
        toast('Counter updated', `Now ${next}`, 'success');
        renderTab();
      };
    });
    body.querySelectorAll('[data-assign]').forEach((b) => {
      b.onclick = () => {
        openModal({
          title: 'Assign employee',
          body: `<select class="select" id="assignSel">
            <option value="">— unassigned —</option>
            ${employees.map((e) => `<option value="${e._id}">${escapeHtml(e.name)}</option>`).join('')}
          </select>`,
          actions: [
            { label: 'Cancel', kind: 'ghost' },
            {
              label: 'Assign', kind: 'primary',
              onClick: async () => {
                const employeeId = document.getElementById('assignSel').value || null;
                await api.put(`/api/admin/counters/${b.dataset.assign}`, { employeeId });
                toast('Assignment saved', '', 'success');
                renderTab();
              },
            },
          ],
        });
      };
    });
  }

  // ---- Users -----------------------------------------------------------
  async function renderUsers(body) {
    const { users } = await api.get('/api/admin/overview');
    body.innerHTML = `
      <div class="flex-between" style="margin-bottom:14px">
        <div class="muted small">${users.length} accounts</div>
        <button class="btn primary sm" id="addUser">+ Create staff account</button>
      </div>
      <div class="card"><div class="table-wrap"><table class="table">
        <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Created</th><th>Status</th><th></th></tr></thead>
        <tbody>
          ${users.map((u) => `
            <tr>
              <td><b>${escapeHtml(u.name)}</b></td>
              <td class="mono">${escapeHtml(u.email)}</td>
              <td><span class="badge ${u.role === 'admin' ? 'gold' : ['employee','outside-usher','room-usher','registrar-staff'].includes(u.role) ? 'accent' : 'grey'}">${escapeHtml(u.role)}${u.roomCode ? ` · ${escapeHtml(u.roomCode)}` : ''}</span></td>
              <td>${fmtDate(u.createdAt)}</td>
              <td>${u.active === false ? '<span class="badge danger">Deactivated</span>' : '<span class="badge success">Active</span>'}</td>
              <td>
                <div class="flex" style="gap:6px">
                  <button class="btn sm ghost" data-role="${u._id}" data-current="${u.role}" data-room="${u.roomCode || ''}">Role</button>
                  <button class="btn sm ghost" data-reset-password="${u._id}">Reset password</button>
                  <button class="btn sm ${u.active === false ? 'primary' : 'danger-ghost'}" data-active="${u._id}" data-status="${u.active === false ? 'off' : 'on'}">
                    ${u.active === false ? 'Activate' : 'Deactivate'}
                  </button>
                </div>
              </td>
            </tr>`).join('')}
        </tbody>
      </table></div></div>`;

    body.querySelector('#addUser').onclick = () => {
      openModal({
        title: 'Create staff account',
        body: `
          <form id="usrForm">
            <div class="field"><label>Full name</label><input class="input" id="u-name" required /></div>
            <div class="field"><label>Email</label><input class="input" id="u-email" type="email" required /></div>
            <div class="form-row">
              <div class="field"><label>Staff role</label>
                <select class="select" id="u-role"><option value="outside-usher">Outside usher</option><option value="room-usher">Room usher</option><option value="registrar-staff">Registrar staff</option><option value="employee">Employee</option><option value="admin">Super admin</option></select>
                <small class="muted" id="userRoleHint">Entrance check-in dashboard. No room assignment needed.</small>
              </div>
              <div class="field"><label>Temporary password</label><input class="input" id="u-pass" type="password" minlength="12" autocomplete="new-password" required /><small class="muted">Use at least 12 characters and share it securely with the staff member.</small></div>
            </div>
            <div class="field" id="userRoomField" hidden><label>Assigned Registrar room</label><select class="select" id="u-room"><option value="OOB">Room OOB</option><option value="OO7">Room OO7</option></select><small class="muted">This account will only access its assigned room dashboard.</small></div>
            <p class="small danger-text" id="userCreateError" hidden></p>
          </form>`,
        actions: [
          { label: 'Cancel', kind: 'ghost' },
          {
            label: 'Create', kind: 'primary',
            onClick: async () => {
              const form = document.getElementById('usrForm');
              if (!form.reportValidity()) return;
              try {
                const role = document.getElementById('u-role').value;
                await api.post('/api/admin/users', {
                  name: document.getElementById('u-name').value.trim(),
                  email: document.getElementById('u-email').value.trim(),
                  password: document.getElementById('u-pass').value,
                  role,
                  ...(['room-usher', 'registrar-staff'].includes(role) ? { roomCode: document.getElementById('u-room').value } : {}),
                });
                closeModal();
                toast('Staff account created', 'They can sign in to their assigned dashboard.', 'success');
                renderTab();
              } catch (err) {
                const error = document.getElementById('userCreateError');
                if (error) { error.textContent = err.message; error.hidden = false; }
              }
            },
            keepOpen: true,
          },
        ],
      });
      const roleSelect = document.getElementById('u-role');
      const roleHint = document.getElementById('userRoleHint');
      const roomRoles = ['room-usher', 'registrar-staff'];
      const descriptions = {
        'outside-usher': 'Entrance check-in dashboard: scan QR codes, verify appointments, and assign rooms.',
        'room-usher': 'Room attendance dashboard: assist check-in and register walk-ins for one room.',
        'registrar-staff': 'Registrar queue dashboard: call and complete appointments in one room.',
        employee: 'Employee dashboard: manage assigned service counters.',
        admin: 'Administrator dashboard: manage the whole QueueFlow system.',
      };
      const updateRoleFields = () => {
        document.getElementById('userRoomField').hidden = !roomRoles.includes(roleSelect.value);
        roleHint.textContent = descriptions[roleSelect.value];
      };
      roleSelect.onchange = updateRoleFields;
      updateRoleFields();
    };

    body.querySelectorAll('[data-active]').forEach((b) => {
      b.onclick = async () => {
        const active = b.dataset.status === 'off';
        await api.put(`/api/admin/users/${b.dataset.active}`, { active });
        toast(active ? 'User activated' : 'User deactivated', '', active ? 'success' : 'warn');
        renderTab();
      };
    });
    body.querySelectorAll('[data-reset-password]').forEach((button) => {
      button.onclick = async () => {
        try {
          const { temporaryPassword, user } = await api.post(`/api/admin/users/${button.dataset.resetPassword}/reset-password`, {});
          openModal({
            title: `Temporary password · ${user.name}`,
            body: `<p>Share this once with <b>${escapeHtml(user.email)}</b> through a secure channel.</p><p class="mono" style="font-size:20px;user-select:all;overflow-wrap:anywhere"><b>${escapeHtml(temporaryPassword)}</b></p>`,
            actions: [{ label: 'Done', kind: 'primary' }],
          });
        } catch (error) { toast('Could not reset password', error.message, 'error'); }
      };
    });
    body.querySelectorAll('[data-role]').forEach((b) => {
      b.onclick = () => {
        openModal({
          title: 'Change role',
          body: `<select class="select" id="roleSel">
            <option value="student">Student</option>
            <option value="employee">Employee</option>
            <option value="outside-usher">Outside usher</option>
            <option value="room-usher">Room usher</option>
            <option value="registrar-staff">Registrar staff</option>
            <option value="admin">Admin</option>
          </select><div class="field" id="roleRoomField" hidden><label>Assigned Registrar room</label><select class="select" id="roleRoom"><option value="OOB">OOB</option><option value="OO7">OO7</option></select></div>`,
          actions: [
            { label: 'Cancel', kind: 'ghost' },
            {
              label: 'Save', kind: 'primary',
              onClick: async () => {
                const role = document.getElementById('roleSel').value;
                await api.put(`/api/admin/users/${b.dataset.role}`, { role, ...(['room-usher', 'registrar-staff'].includes(role) ? { roomCode: document.getElementById('roleRoom').value } : {}) });
                toast('Role updated', '', 'success');
                renderTab();
              },
            },
          ],
        });
        const roleSelect = document.getElementById('roleSel');
        roleSelect.value = b.dataset.current;
        if (b.dataset.room) document.getElementById('roleRoom').value = b.dataset.room;
        document.getElementById('roleRoomField').hidden = !['room-usher', 'registrar-staff'].includes(roleSelect.value);
        roleSelect.onchange = () => { document.getElementById('roleRoomField').hidden = !['room-usher', 'registrar-staff'].includes(roleSelect.value); };
      };
    });
  }

  // ---- Registrar appointments --------------------------------------
  async function renderAppointments(body) {
    const renderList = async () => {
      const query = new URLSearchParams({
        date: body.querySelector('#appointmentDateFilter').value,
        status: body.querySelector('#appointmentStatusFilter').value,
        room: body.querySelector('#appointmentRoomFilter').value,
        q: body.querySelector('#appointmentQuery').value.trim(),
      });
      const { appointments, summary } = await api.get('/api/registrar/admin/appointments?' + query);
      body.querySelector('#appointmentSummary').textContent = 'Booked ' + (summary.booked || 0) + ' | Checked in ' + (summary['checked-in'] || 0) + ' | Pending ' + (summary.pending || 0) + ' | Called ' + (summary.called || 0) + ' | Completed ' + (summary.completed || 0) + ' | OOB ' + (summary['room:OOB'] || 0) + ' | OO7 ' + (summary['room:OO7'] || 0);
      body.querySelector('#appointmentRows').innerHTML = appointments.map((ticket) => '<tr><td><b>' + escapeHtml(ticket.queueNumber || ticket.code) + '</b><div class="small muted">' + escapeHtml(ticket.appointmentNumber || '') + '</div></td><td>' + escapeHtml(ticket.userName || '') + '<div class="small muted">' + escapeHtml(ticket.studentId || '') + '</div></td><td>' + escapeHtml(ticket.registrarProfile?.certificateType || '') + '<div class="small muted">' + escapeHtml(ticket.registrarProfile?.major || '') + '</div></td><td>' + escapeHtml(ticket.appointmentDate || '') + ' ' + escapeHtml(ticket.timeSlot || '') + '</td><td>' + escapeHtml(ticket.roomCode || ticket.suggestedRoomCode || 'Unassigned') + '</td><td>' + escapeHtml(ticket.registrarProfile?.paymentStatus || '') + ' / ' + escapeHtml(ticket.registrarProfile?.documentsStatus || '') + '</td><td><span class="badge ' + (ticket.appointmentStatus === 'completed' ? 'success' : ticket.appointmentStatus === 'pending' ? 'warn' : ticket.appointmentStatus === 'called' ? 'accent' : 'grey') + '">' + escapeHtml(ticket.appointmentStatus || 'booked') + '</span></td></tr>').join('') || '<tr><td colspan="7" class="empty">No appointments match these filters.</td></tr>';
    };
    body.innerHTML = '<div class="card card-pad"><div class="page-head"><h2>Appointment management</h2><div class="sub">Bookings, room workload, and appointment status.</div></div><div class="registrar-ops-stats" id="appointmentSummary"></div><form id="appointmentFilters" class="appointment-filters"><input class="input" type="date" id="appointmentDateFilter"/><select class="select" id="appointmentStatusFilter"><option value="">All statuses</option><option>booked</option><option>checked-in</option><option>pending</option><option>called</option><option>completed</option><option>cancelled</option></select><select class="select" id="appointmentRoomFilter"><option value="">All rooms</option><option>OOB</option><option>OO7</option></select><input class="input" id="appointmentQuery" placeholder="Name, student ID, queue or appointment number"/><button class="btn primary" type="submit">Filter</button></form></div><div class="card room-queue-card"><div class="table-wrap"><table class="table"><thead><tr><th>Queue</th><th>Student</th><th>Certificate / major</th><th>Appointment</th><th>Room</th><th>Payment / papers</th><th>Status</th></tr></thead><tbody id="appointmentRows"></tbody></table></div></div>';
    const now = new Date();
    body.querySelector('#appointmentDateFilter').value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    body.querySelector('#appointmentFilters').onsubmit = async (event) => { event.preventDefault(); await renderList(); };
    await renderList();
  }

  async function renderBookingSchedule(body) {
    const settings = await api.get('/api/admin/registrar/booking-settings');
    const days = [['sunday','Sunday'],['monday','Monday'],['tuesday','Tuesday'],['wednesday','Wednesday'],['thursday','Thursday'],['friday','Friday'],['saturday','Saturday']];
    body.innerHTML = `<section class="card card-pad"><div class="page-head"><h2>Registrar booking schedule</h2><div class="sub">Online bookings are for today, 8:00 AM–3:00 PM. Staff walk-in registration remains available when online bookings are closed.</div></div><form id="bookingScheduleForm"><label class="flex"><input type="checkbox" id="bookingEnabled" ${settings.enabled ? 'checked' : ''}/> Accept online bookings</label><h3 class="section-gap">Closed days</h3><div class="grid cols-3">${days.map(([key,label]) => `<label class="flex"><input type="checkbox" name="closedDay" value="${key}" ${settings.closedDays.includes(key) ? 'checked' : ''}/> ${label}</label>`).join('')}</div><div class="flex" style="margin-top:18px"><button class="btn primary" type="submit">Save schedule</button><span class="muted small">Friday and Saturday are closed by default.</span></div></form></section>`;
    body.querySelector('#bookingScheduleForm').onsubmit = async (event) => {
      event.preventDefault();
      try {
        const closedDays = [...body.querySelectorAll('input[name="closedDay"]:checked')].map((input) => input.value);
        await api.put('/api/admin/registrar/booking-settings', { enabled: body.querySelector('#bookingEnabled').checked, closedDays });
        toast('Booking schedule saved', 'Online booking hours and closed days updated.', 'success');
      } catch (error) { toast('Could not save schedule', error.message, 'error'); }
    };
  }

  async function renderAudit(body) {
    const { logs } = await api.get('/api/registrar/admin/audit');
    body.innerHTML = `<div class="card"><div class="card-pad"><h2>Audit log</h2><p class="muted small">Entrance verification, room assignment, attendance, calls, skips, and completion records.</p></div><div class="table-wrap"><table class="table"><thead><tr><th>Time</th><th>Action</th><th>Appointment</th><th>Actor</th><th>Details</th></tr></thead><tbody>${logs.map((item) => `<tr><td>${fmtDateTime(item.createdAt)}</td><td><b>${escapeHtml(item.action)}</b></td><td>${escapeHtml(item.appointmentNumber || '')}</td><td>${escapeHtml(item.actorEmail || '')}<div class="small muted">${escapeHtml(item.actorRole || '')}</div></td><td>${escapeHtml(JSON.stringify(item.details || {}))}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">No audit events yet.</td></tr>'}</tbody></table></div></div>`;
  }

  // ---- Integration ------------------------------------------------------
  async function renderIntegration(body) {
    const status = await api.get('/api/integration/status').catch(() => ({ connected: false }));
    let legacyQueues = [];
    if (status.connected) {
      legacyQueues = (await api.get('/api/integration/legacy/queues').catch(() => ({ queues: [] }))).queues || [];
    }

    body.innerHTML = `
      <div class="card card-pad" style="margin-bottom:16px">
        <div class="flex-between">
          <div>
            <h3 class="card-title" style="margin:0">Existing Queue System (Legacy API)</h3>
            <div class="small muted">QueueFlow integrates via REST — the legacy system keeps operating unchanged.</div>
          </div>
          ${status.connected
            ? '<span class="badge success">● Connected</span>'
            : '<span class="badge danger">○ Unreachable</span>'}
        </div>
        <div class="table-wrap" style="margin-top:12px"><table class="table">
          <tr><td class="muted">Endpoint</td><td class="mono">${status.connected ? escapeHtml(status.health?.system || 'Legacy Queue System') : '—'}</td></tr>
          <tr><td class="muted">Uptime since</td><td class="mono">${status.connected ? fmtDateTime(status.health?.startedAt) : '—'}</td></tr>
          <tr><td class="muted">Legacy queues</td><td><b>${legacyQueues.length}</b></td></tr>
        </table></div>
        <div class="flex" style="gap:8px;margin-top:12px;flex-wrap:wrap">
          <button class="btn primary sm" id="syncBtn">⇅ Sync legacy tickets now</button>
          <button class="btn ghost sm" id="pushBtn">⇧ Push queue summary</button>
          <button class="btn ghost sm" id="refreshInt">↻ Refresh status</button>
        </div>
      </div>

      <div class="grid cols-2">
        <div class="card">
          <div class="card-pad" style="padding-bottom:0"><h3 class="card-title">Legacy queues</h3></div>
          ${legacyQueues.map((q) => `
            <div class="queue-item" style="padding:10px 16px">
              <div class="qi-main">
                <div class="qi-name">${escapeHtml(q.name)} <span class="small mono muted">${escapeHtml(q.id)}</span></div>
                <div class="qi-sub">${escapeHtml(q.building)} · ${q.waiting} waiting · ${q.open ? 'open' : 'closed'}</div>
              </div>
              <span class="badge ${q.open ? 'success' : 'grey'}">${q.open ? 'Open' : 'Closed'}</span>
            </div>`).join('') || '<div class="empty small">—</div>'}
        </div>
        <div class="card card-pad">
          <h3 class="card-title">How the integration works</h3>
          <ol class="small muted" style="padding-left:18px;margin:0">
            <li style="margin-bottom:8px">The platform calls the legacy REST API (<code class="mono">/api/legacy/*</code>) over HTTP — no database sharing.</li>
            <li style="margin-bottom:8px"><b>Sync</b> pulls queues & tickets and maps them into QueueFlow services (channel: <code class="mono">legacy</code>).</li>
            <li style="margin-bottom:8px">Bookings created through the legacy endpoint are visible in both systems after sync.</li>
            <li>Point <code class="mono">LEGACY_API_BASE</code> at the real system to go live.</li>
          </ol>
        </div>
      </div>`;

    body.querySelector('#syncBtn').onclick = async (e) => {
      e.target.disabled = true;
      e.target.textContent = 'Syncing…';
      try {
        const res = await api.post('/api/integration/sync');
        toast('Sync complete', `${res.created} created · ${res.updated} updated across ${res.queues} queues`, 'success');
        renderTab();
      } catch (err) { toast('Sync failed', err.message, 'error'); }
    };
    body.querySelector('#pushBtn').onclick = async (e) => {
      e.target.disabled = true;
      try {
        const res = await api.post('/api/integration/push');
        toast('Pushed to legacy', `${res.pushed.length} service summaries sent`, 'success');
      } catch (err) { toast('Push failed', err.message, 'error'); }
    };
    body.querySelector('#refreshInt').onclick = () => renderTab();
  }

  // ---- Notifications ---------------------------------------------------
  async function renderNotifications(body) {
    const { notifications } = await api.get('/api/admin/notifications');
    body.innerHTML = `
      <div class="card">
        <div class="card-pad" style="padding-bottom:0"><h3 class="card-title">Notification & email log</h3></div>
        ${notifications.map((n) => `
          <div class="queue-item" style="padding:10px 16px">
            <span style="font-size:17px">${n.channel === 'smtp' ? '✉️' : n.channel === 'inapp' ? '🔔' : '📝'}</span>
            <div class="qi-main">
              <div class="qi-name small">${escapeHtml(n.subject)}</div>
              <div class="qi-sub">${escapeHtml(n.text || '')}</div>
            </div>
            <div style="text-align:right">
              <span class="badge ${n.status === 'sent' || n.status === 'delivered' ? 'success' : 'danger'}">${escapeHtml(n.status)}</span>
              <div class="small muted" style="margin-top:4px">${fmtDateTime(n.createdAt)}</div>
              <div class="small mono muted">${escapeHtml(n.to || '')}</div>
            </div>
          </div>`).join('') || '<div class="empty">No notifications sent yet</div>'}
      </div>`;
  }

  await renderTab();

  // live refresh of overview tab
  const handler = () => { if (tab === 'overview') renderTab(); };
  socket.on('queue:updated', handler);
  socket.on('alert', (data) => {
    toast('Queue threshold exceeded', data.message, 'warn', 7000);
  });
  return () => socket.off('queue:updated', handler);
}
