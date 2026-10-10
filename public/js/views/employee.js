// Employee dashboard: queue management console
import { api, socket } from '../api.js';
import { toast, etaText, fmtTime, statusBadge, escapeHtml } from '../ui.js';

export async function renderEmployee(view) {
  if (!api.user || api.user.role === 'student') {
    location.hash = '#/login?redirect=%23%2Femployee';
    return;
  }
  view.innerHTML = `<div class="spinner"></div>`;

  const [queuesData, statsData] = await Promise.all([
    api.get('/api/employee/queues').catch(() => ({ queues: [] })),
    api.get('/api/employee/stats').catch(() => ({})),
  ]);
  let { queues } = queuesData;
  const stats = statsData;

  const paint = () => {
    view.innerHTML = `
      <div class="page-head-row">
        <div class="page-head"><h1>Employee Console</h1>
          <div class="sub">${escapeHtml(api.user.name)} · manage service counters</div>
        </div>
        <div class="flex">
          <span class="badge accent">Served today: <b class="mono" style="margin-left:4px">${stats.servedToday ?? 0}</b></span>
          <span class="badge grey">Avg service: <b class="mono" style="margin-left:4px">${stats.avgServiceMinutes ?? 0} min</b></span>
        </div>
      </div>
      <div class="grid cols-2" id="queuesGrid">
        ${queues.map(queuePanel).join('') || '<div class="empty"><div class="e-icon">📭</div>No active queues assigned.</div>'}
      </div>`;
    wire();
  };

  function queuePanel(q) {
    const called = q.called || [];
    return `
      <div class="card" data-queue="${q._id}">
        <div class="card-pad" style="border-bottom:1px solid var(--line)">
          <div class="flex-between">
            <div>
              <h3 class="card-title" style="margin:0">${escapeHtml(q.name)}</h3>
              <div class="small muted">${escapeHtml(q.building)} · <b class="mono">${q.waiting.length}</b> waiting · <b class="mono">${called.length}</b> called</div>
            </div>
            <span class="badge ${q.waiting.length >= 15 ? 'danger' : q.waiting.length >= 8 ? 'warn' : 'success'}">
              ${q.waiting.length >= 15 ? '🔥 Busy' : q.waiting.length >= 8 ? 'Moderate' : 'Smooth'}
            </span>
          </div>
        </div>

        <div class="card-pad" style="padding-bottom:6px">
          <div class="small muted" style="margin-bottom:8px"><b>Counters</b></div>
          <div class="flex" style="gap:8px;flex-wrap:wrap">
            ${q.counters.map((c) => `
              <div class="flex" style="gap:6px;border:1px solid var(--line);border-radius:9px;padding:5px 10px;background:${c.status === 'open' ? 'var(--success-soft)' : '#f1f3f8'}">
                <span style="width:8px;height:8px;border-radius:50%;background:${c.status === 'open' ? 'var(--success)' : 'var(--ink-3)'}"></span>
                <span class="small"><b>${escapeHtml(c.name)}</b></span>
                <button class="btn sm ${c.status === 'open' ? 'ghost' : 'primary'}" data-toggle-counter="${c._id}" data-status="${c.status}">
                  ${c.status === 'open' ? 'Close' : 'Open'}
                </button>
              </div>`).join('')}
          </div>
        </div>

        <div style="padding:6px 16px 10px">
          <div class="small muted" style="margin-bottom:6px"><b>Now calling</b></div>
          ${called.length ? called.map((t) => calledRow(t)).join('') : '<div class="small muted" style="padding:6px 0 10px">No ticket is being served right now.</div>'}
        </div>

        <div style="padding:0 16px 8px;max-height:300px;overflow:auto">
          <div class="small muted" style="margin:6px 0"><b>Waiting (${q.waiting.length})</b></div>
          ${q.waiting.map((t, i) => waitingRow(t, i)).join('') || '<div class="small muted" style="padding:6px 0">Queue is empty 🎉</div>'}
        </div>

        <div class="card-pad" style="padding-top:10px;border-top:1px solid var(--line)">
          <button class="btn primary btn-block" data-call-next="${q._id}" ${q.waiting.length === 0 ? 'disabled' : ''}>
            🔔 Call next ticket
          </button>
        </div>
      </div>`;
  }

  function calledRow(t) {
    return `
      <div class="queue-item" style="background:var(--gold-soft);border-radius:10px;margin-bottom:8px">
        <div class="ticket-code" style="background:#fff;color:#9c6d07">${escapeHtml(t.code)}</div>
        <div class="qi-main">
          <div class="qi-name">${escapeHtml(t.userName || 'Walk-in')} ${t.priority === 'high' ? '<span class="priority-flag">⭐</span>' : ''}</div>
          <div class="qi-sub">${escapeHtml(t.counterName || '')} · waited ${t.waitMinutes ?? '—'} min · called ${fmtTime(t.calledAt)}</div>
        </div>
        <div class="flex" style="gap:6px">
          <button class="btn sm ghost" data-recall="${t._id}">🔁 Recall</button>
          <button class="btn sm accent" data-serve="${t._id}">✓ Serve</button>
          <button class="btn sm danger-ghost" data-noshow="${t._id}">No-show</button>
        </div>
      </div>`;
  }

  function waitingRow(t, i) {
    return `
      <div class="queue-item">
        <div class="position-bubble ${t.priority === 'high' ? 'high' : ''}">${i + 1}</div>
        <div class="ticket-code">${escapeHtml(t.code)}</div>
        <div class="qi-main">
          <div class="qi-name">${escapeHtml(t.userName || 'Walk-in')} ${t.priority === 'high' ? '<span class="priority-flag">⭐ priority</span>' : ''}</div>
          <div class="qi-sub">${t.note ? escapeHtml(t.note) + ' · ' : ''}joined ${fmtTime(t.createdAt)} · est. ${etaText(t.etaMinutes ?? 0)}</div>
        </div>
      </div>`;
  }

  function wire() {
    view.querySelectorAll('[data-call-next]').forEach((btn) => {
      btn.onclick = async () => {
        const q = queues.find((x) => x._id === btn.dataset.callNext);
        const mine = (q.myCounters || q.counters || []).filter((c) => c.status === 'open' && (c.employeeId === api.user._id || api.user.role === 'admin'));
        const counter = mine[0] || (q.counters || []).find((c) => c.status === 'open');
        if (!counter) { toast('No open counter', 'Open a counter first', 'warn'); return; }
        try {
          const { ticket } = await api.post(`/api/employee/counters/${counter._id}/call`, { serviceId: q._id });
          toast('Ticket called 🔔', `${ticket.code} → ${ticket.counterName || counter.name}`, 'success');
        } catch (err) { toast('Call failed', err.message, 'error'); }
      };
    });
    view.querySelectorAll('[data-serve]').forEach((btn) => {
      btn.onclick = async () => {
        try {
          const { ticket } = await api.post(`/api/employee/tickets/${btn.dataset.serve}/serve`);
          toast('Served ✓', `${ticket.code} completed`, 'success');
        } catch (err) { toast('Failed', err.message, 'error'); }
      };
    });
    view.querySelectorAll('[data-noshow]').forEach((btn) => {
      btn.onclick = async () => {
        try {
          await api.post(`/api/employee/tickets/${btn.dataset.noshow}/noshow`);
          toast('Marked no-show', '', 'warn');
        } catch (err) { toast('Failed', err.message, 'error'); }
      };
    });
    view.querySelectorAll('[data-recall]').forEach((btn) => {
      btn.onclick = async () => {
        try {
          await api.post(`/api/employee/tickets/${btn.dataset.recall}/recall`);
          toast('Recalled 🔁', 'Announcement repeated', 'info');
        } catch (err) { toast('Failed', err.message, 'error'); }
      };
    });
    view.querySelectorAll('[data-toggle-counter]').forEach((btn) => {
      btn.onclick = async () => {
        const next = btn.dataset.status === 'open' ? 'closed' : 'open';
        try {
          await api.put(`/api/admin/counters/${btn.dataset.toggleCounter}`, { status: next });
          toast('Counter updated', `Now ${next}`, 'success');
          await refresh();
        } catch (err) { toast('Failed', err.message, 'error'); }
      };
    });
  }

  const refresh = async () => {
    try {
      const data = await api.get('/api/employee/queues');
      queues = data.queues;
      const statsRes = await api.get('/api/employee/stats').catch(() => null);
      if (statsRes) Object.assign(stats, statsRes);
      paint();
    } catch (err) { /* transient */ }
  };

  paint();

  const handler = () => refresh();
  socket.on('queue:updated', handler);
  socket.on('ticket:called', handler);
  socket.on('ticket:served', handler);
  return () => {
    socket.off('queue:updated', handler);
    socket.off('ticket:called', handler);
    socket.off('ticket:served', handler);
  };
}
