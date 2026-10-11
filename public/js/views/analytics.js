// Smart analytics dashboard
import { api } from '../api.js';
import { toast, fmtDate, escapeHtml, barChart, lineChart, donut, heatmapGrid, stars, etaText } from '../ui.js';

export async function renderAnalytics(view) {
  if (!api.user || api.user.role === 'student') {
    location.hash = '#/login?redirect=%23%2Fanalytics';
    return;
  }
  view.innerHTML = `<div class="spinner"></div>`;

  const [ov, heat, svcStats, forecast, trends, fb] = await Promise.all([
    api.get('/api/analytics/overview?days=1').catch(() => ({})),
    api.get('/api/analytics/heatmap?days=7').catch(() => ({})),
    api.get('/api/analytics/services?days=7').catch(() => ({ services: [] })),
    api.get('/api/analytics/forecast').catch(() => ({})),
    api.get('/api/analytics/trends?days=14').catch(() => ({ days: [] })),
    api.get('/api/analytics/feedback?days=30').catch(() => ({})),
  ]);

  view.innerHTML = `
    <div class="page-head-row">
      <div class="page-head"><h1>Smart Analytics</h1>
        <div class="sub">Operations intelligence — waits, demand forecasts and CSAT</div>
      </div>
      <div class="flex">
        <select class="select" id="rangeSel" style="width:auto">
          <option value="1">Today</option>
          <option value="7" selected>Last 7 days</option>
          <option value="30">Last 30 days</option>
        </select>
      </div>
    </div>

    <div class="grid cols-4">
      <div class="card kpi brand"><div class="kpi-label">Tickets (${escapeHtml(ov.period || '')})</div><div class="kpi-value mono">${ov.totalTickets ?? 0}</div><div class="kpi-sub">${ov.served ?? 0} served · ${ov.waitingNow ?? 0} in queue now</div></div>
      <div class="card kpi accent"><div class="kpi-label">Avg wait</div><div class="kpi-value mono">${ov.avgWaitSamples ? ov.avgWaitMinutes : '—'}<span style="font-size:14px"> min</span></div><div class="kpi-sub">${ov.avgWaitSamples ? `Calculated from ${ov.avgWaitSamples} completed visits` : 'No completed visits in this period'}</div></div>
      <div class="card kpi gold"><div class="kpi-label">CSAT</div><div class="kpi-value mono">${ov.csat || '—'}<span style="font-size:14px"> /5</span></div><div class="kpi-sub">${ov.feedbackCount ?? 0} ratings · ${ov.responseRate ?? 0}% response rate</div></div>
      <div class="card kpi danger"><div class="kpi-label">Forecast next hour</div><div class="kpi-value mono">${(forecast.next2Hours || [])[1]?.expected ?? 0}</div><div class="kpi-sub">expected arrivals · peak ${String(forecast.peakHour ?? 0).padStart(2, '0')}:00</div></div>
    </div>

    <div class="section-gap grid cols-2">
      <div class="card card-pad">
        <h3 class="card-title">📈 Daily volume & wait time (14 days)</h3>
        ${lineChart({
          series: [
            trends.days.map((d) => d.total),
            trends.days.map((d) => Math.round(d.avgWait)),
          ],
          labels: trends.days.map((d) => d.weekday + ' ' + d.date.slice(5)),
        })}
        <div class="small muted">Blue: tickets per day · Teal: average wait (min)</div>
      </div>
      <div class="card card-pad">
        <h3 class="card-title">🗓️ Arrival heatmap (hour × weekday, 7 days)</h3>
        ${heatmapGrid({ data: heat.arrivals || Array.from({ length: 7 }, () => Array(24).fill(0)), days: 7, height: 220 })}
        <div class="small muted">Darker = more arrivals. Plan staffing around the 9:00–13:00 peak.</div>
      </div>
    </div>

    <div class="section-gap grid cols-2">
      <div class="card card-pad">
        <h3 class="card-title">🧮 Per-service performance (7 days)</h3>
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Service</th><th>Total</th><th>Served</th><th>Avg wait</th><th>Avg svc</th><th>CSAT</th><th>Priority</th></tr></thead>
          <tbody>
            ${svcStats.services.map((s) => `
              <tr>
                <td><b>${escapeHtml(s.name)}</b><div class="small muted">${escapeHtml(s.building)}</div></td>
                <td class="mono">${s.total}</td>
                <td class="mono">${s.served}</td>
                <td class="mono">${s.avgWaitSamples ? `${s.avgWaitMinutes}m` : '—'}</td>
                <td class="mono">${s.avgServiceMinutes}m</td>
                <td>${s.csat ? stars(Math.round(s.csat)) : '—'}</td>
                <td class="mono">${s.priorityShare}%</td>
              </tr>`).join('')}
          </tbody>
        </table></div>
      </div>
      <div class="card card-pad">
        <h3 class="card-title">⏳ Demand forecast (next 2 hours)</h3>
        ${barChart({
          data: (forecast.next2Hours || []).map((h) => h.expected),
          labels: (forecast.next2Hours || []).map((h) => h.label),
          height: 160,
        })}
        <p class="small muted">Based on the same weekday/hour pattern over the last ${forecast.historyDays ?? 14} days.</p>

        <h3 class="card-title" style="margin-top:18px">⭐ Rating distribution (30 days)</h3>
        ${donut({
          parts: [
            { label: '5 stars', value: (fb.distribution || {}).five || (fb.distribution || {})['5'] || 0, color: '#1f9d55' },
            { label: '4 stars', value: (fb.distribution || {}).four || (fb.distribution || {})['4'] || 0, color: '#7bbf7b' },
            { label: '3 stars', value: (fb.distribution || {}).three || (fb.distribution || {})['3'] || 0, color: '#e9a319' },
            { label: '2 stars', value: (fb.distribution || {}).two || (fb.distribution || {})['2'] || 0, color: '#e07a3f' },
            { label: '1 star', value: (fb.distribution || {}).one || (fb.distribution || {})['1'] || 0, color: '#dc0006' },
          ],
        })}
      </div>
    </div>

    <div class="section-gap">
      <div class="card">
        <div class="card-pad" style="padding-bottom:0"><h3 class="card-title">💬 Latest feedback comments</h3></div>
        ${(fb.comments || []).slice(0, 12).map((c) => `
          <div class="queue-item" style="padding:12px 16px">
            <div style="min-width:86px">${stars(c.rating)}</div>
            <div class="qi-main">
              <div class="qi-name small">${escapeHtml(c.userName)} <span class="muted">· ${escapeHtml(c.serviceName)}</span></div>
              <div class="qi-sub">${escapeHtml(c.comment)}</div>
            </div>
            <small class="muted">${fmtDate(c.createdAt)}</small>
          </div>`).join('') || '<div class="empty">No comments yet</div>'}
      </div>
    </div>
  `;
}
