// Admin dashboard: overview, services, counters, users, integration, notifications
import { api, socket } from '../api.js';
import { toast, fmtTime, fmtDateTime, statusBadge, escapeHtml, openModal, barChart } from '../ui.js';

const TABS = [
  ['overview', '📊 Overview'],
  ['services', '🗂️ Services'],
  ['counters', '🖥️ Counters'],
  ['users', '👥 Users'],
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
      else if (tab === 'integration') await renderIntegration(body);
      else if (tab === 'notifications') await renderNotifications(body);
    } catch (err) {
      body.innerHTML = `<div class="alert-banner">⚠️ ${escapeHtml(err.message)}</div>`;
    }
  }

  // ---- Overview ------------------------------------------------------
  async function renderOverview(body) {
    const { data } = await api.get('/api/admin/overview');
    const { today, week, services, users, counters, notifications } = data;
    const live = today.liveQueues || [];

    body.innerHTML = `
      <div class="grid cols-4">
        <div class="card kpi brand"><div class="kpi-label">Tickets today</div><div class="kpi-value mono">${today.totalTickets}</div><div class="kpi-sub">${today.served} served</div></div>
        <div class="card kpi accent"><div class="kpi-label">Avg wait</div><div class="kpi-value mono">${today.avgWaitMinutes}<span style="font-size:14px"> min</span></div><div class="kpi-sub">p95: ${today.p95WaitMinutes} min</div></div>
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
              <div class="field"><label>Avg service (min)</label><input class="input" id="f-avg" type="number" min="1" max="120" value="${svc?.avgServiceMinutes || 5}" /></div>
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
    const { data } = await api.get('/api/admin/overview');
    const { counters, services, users } = data;
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
    const { data } = await api.get('/api/admin/overview');
    const { users } = data;
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
              <td><span class="badge ${u.role === 'admin' ? 'gold' : u.role === 'employee' ? 'accent' : 'grey'}">${u.role}</span></td>
              <td>${fmtDate(u.createdAt)}</td>
              <td>${u.active === false ? '<span class="badge danger">Deactivated</span>' : '<span class="badge success">Active</span>'}</td>
              <td>
                <div class="flex" style="gap:6px">
                  <button class="btn sm ghost" data-role="${u._id}" data-current="${u.role}">Role</button>
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
              <div class="field"><label>Role</label>
                <select class="select" id="u-role"><option value="employee">Employee</option><option value="admin">Admin</option></select>
              </div>
              <div class="field"><label>Temporary password</label><input class="input" id="u-pass" type="password" value="Changeme@123" /></div>
            </div>
          </form>`,
        actions: [
          { label: 'Cancel', kind: 'ghost' },
          {
            label: 'Create', kind: 'primary',
            onClick: async () => {
              try {
                await api.post('/api/admin/users', {
                  name: document.getElementById('u-name').value.trim(),
                  email: document.getElementById('u-email').value.trim(),
                  password: document.getElementById('u-pass').value,
                  role: document.getElementById('u-role').value,
                });
                toast('Staff account created', '', 'success');
                renderTab();
              } catch (err) { toast('Failed', err.message, 'error'); }
            },
          },
        ],
      });
    };

    body.querySelectorAll('[data-active]').forEach((b) => {
      b.onclick = async () => {
        const active = b.dataset.status === 'off';
        await api.put(`/api/admin/users/${b.dataset.active}`, { active });
        toast(active ? 'User activated' : 'User deactivated', '', active ? 'success' : 'warn');
        renderTab();
      };
    });
    body.querySelectorAll('[data-role]').forEach((b) => {
      b.onclick = () => {
        openModal({
          title: 'Change role',
          body: `<select class="select" id="roleSel">
            <option value="student">Student</option>
            <option value="employee">Employee</option>
            <option value="admin">Admin</option>
          </select>`,
          actions: [
            { label: 'Cancel', kind: 'ghost' },
            {
              label: 'Save', kind: 'primary',
              onClick: async () => {
                await api.put(`/api/admin/users/${b.dataset.role}`, { role: document.getElementById('roleSel').value });
                toast('Role updated', '', 'success');
                renderTab();
              },
            },
          ],
        });
      };
    });
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
