import { api } from '../api.js';
import { escapeHtml } from '../ui.js';

const dashboardRoutes = {
  admin: ['#/admin', 'Admin dashboard'],
  employee: ['#/employee', 'Staff dashboard'],
  'registrar-staff': ['#/registrar', 'Registrar room dashboard'],
  'room-usher': ['#/room', 'Room usher dashboard'],
  'outside-usher': ['#/outside', 'Entrance check-in dashboard'],
};

export function renderAccount(view) {
  const user = api.user;
  if (!user) {
    location.hash = '#/login?redirect=%23%2Faccount';
    return;
  }

  const dashboard = dashboardRoutes[user.role];
  const label = String(user.role || 'student').replaceAll('-', ' ');
  view.innerHTML = `
    <section class="account-page">
      <header class="account-heading">
        <div><span class="services-eyebrow">YOUR QUEUEFLOW ACCOUNT</span><h1>Account overview</h1><p class="sub">Your profile and the tools available for your role.</p></div>
        <span class="badge success account-status">Signed in</span>
      </header>
      <div class="account-grid">
        <article class="card account-profile">
          <div class="account-avatar">${escapeHtml((user.name || 'U').split(/\s+/).map(part => part[0]).slice(0, 2).join('').toUpperCase())}</div>
          <div><h2>${escapeHtml(user.name || 'QueueFlow user')}</h2><span class="badge">${escapeHtml(label)}</span></div>
          <dl class="account-details">
            <div><dt>Email</dt><dd>${escapeHtml(user.email || '—')}</dd></div>
            ${user.studentId ? `<div><dt>MIU ID</dt><dd>${escapeHtml(user.studentId)}</dd></div>` : ''}
            ${user.roomCode ? `<div><dt>Assigned room</dt><dd>Room ${escapeHtml(user.roomCode)}</dd></div>` : ''}
          </dl>
        </article>
        <article class="card account-actions">
          <h2>Quick links</h2>
          <a class="account-action" href="#/portal"><span class="account-action-icon">▤</span><span><strong>My Queue</strong><small>View and manage your queue tickets</small></span><b aria-hidden="true">→</b></a>
          ${dashboard ? `<a class="account-action" href="${dashboard[0]}"><span class="account-action-icon">▦</span><span><strong>${dashboard[1]}</strong><small>Open the tools assigned to your account</small></span><b aria-hidden="true">→</b></a>` : ''}
          <a class="account-action" href="#/"> <span class="account-action-icon">⌂</span><span><strong>Student services</strong><small>Browse office queues and book a visit</small></span><b aria-hidden="true">→</b></a>
        </article>
      </div>
      <article class="card account-password-card">
        <div><h2>Change password</h2><p class="muted small">Choose at least 12 characters. Update the temporary password after your first sign-in.</p></div>
        <form id="changePasswordForm" class="account-password-form">
          <div class="form-row">
            <div class="field"><label for="currentPassword">Current password</label><input class="input" id="currentPassword" type="password" autocomplete="current-password" required /></div>
            <div class="field"><label for="newPassword">New password</label><input class="input" id="newPassword" type="password" minlength="12" autocomplete="new-password" required /></div>
            <div class="field"><label for="confirmPassword">Confirm new password</label><input class="input" id="confirmPassword" type="password" minlength="12" autocomplete="new-password" required /></div>
          </div>
          <div class="flex-between"><p class="form-error" id="passwordError" hidden></p><button class="btn primary" type="submit">Update password</button></div>
        </form>
      </article>
      <p class="account-note">For account or role changes, contact the QueueFlow administrator.</p>
    </section>`;

  view.querySelector('#changePasswordForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const error = view.querySelector('#passwordError');
    error.hidden = true;
    const newPassword = view.querySelector('#newPassword').value;
    if (newPassword !== view.querySelector('#confirmPassword').value) {
      error.textContent = 'The new passwords do not match.';
      error.hidden = false;
      return;
    }
    try {
      await api.post('/api/auth/change-password', { currentPassword: view.querySelector('#currentPassword').value, newPassword });
      form.reset();
      error.className = 'form-success';
      error.textContent = 'Password updated successfully.';
      error.hidden = false;
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
    }
  });
}
