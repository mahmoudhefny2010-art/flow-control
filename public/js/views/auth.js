// Auth views: login + register
import { api } from '../api.js';
import { toast, escapeHtml } from '../ui.js';

export function renderLogin(view, params) {
  const redirect = params.get('redirect') || '#/portal';
  view.innerHTML = `
    <div class="auth-wrap">
      <div class="card auth-card">
        <h1>Welcome back</h1>
        <div class="sub">Sign in to MIU QueueFlow</div>
        <form id="loginForm" novalidate>
          <div class="field">
            <label for="email">University email</label>
            <input class="input" id="email" type="email" placeholder="you@miu.edu.eg" required autocomplete="username" />
          </div>
          <div class="field">
            <label for="password">Password</label>
            <input class="input" id="password" type="password" placeholder="••••••••" required autocomplete="current-password" />
          </div>
          <div class="form-error" id="formError" hidden></div>
          <button class="btn primary btn-block lg" type="submit">Sign in</button>
        </form>
        <p class="small muted" style="margin-top:14px;text-align:center">
          New to QueueFlow? <a href="#/register">Create a student account</a>
        </p>
        <div class="demo-accounts">
          <h4>Demo accounts</h4>
          <div class="flex" style="justify-content:space-between;gap:8px;flex-wrap:wrap">
            <span>Admin <code>admin@miu.edu.eg</code> / <code>Admin@1234</code></span>
          </div>
          <div class="flex" style="justify-content:space-between;gap:8px;flex-wrap:wrap;margin-top:6px">
            <span>Employee <code>officer@miu.edu.eg</code> / <code>Officer@1234</code></span>
          </div>
          <div class="flex" style="justify-content:space-between;gap:8px;flex-wrap:wrap;margin-top:6px">
            <span>Student <code>student@miu.edu.eg</code> / <code>Student@1234</code></span>
          </div>
        </div>
      </div>
    </div>`;

  view.querySelector('#loginForm').onsubmit = async (e) => {
    e.preventDefault();
    const errEl = view.querySelector('#formError');
    errEl.hidden = true;
    const email = view.querySelector('#email').value.trim();
    const password = view.querySelector('#password').value;
    try {
      const data = await api.post('/api/auth/login', { email, password });
      api.login(data.token, data.user);
      toast(`Welcome, ${data.user.name.split(' ')[0]}`, 'Signed in successfully', 'success');
      location.hash = redirect.startsWith('#') ? redirect : '#/portal';
    } catch (err) {
      errEl.textContent = err.message;
      errEl.hidden = false;
    }
  };
}

export function renderRegister(view) {
  view.innerHTML = `
    <div class="auth-wrap">
      <div class="card auth-card">
        <h1>Create account</h1>
        <div class="sub">Student self-registration — you can book queue tickets immediately after signing up.</div>
        <form id="regForm" novalidate>
          <div class="field">
            <label for="name">Full name</label>
            <input class="input" id="name" placeholder="e.g. Ahmed Hassan" required />
          </div>
          <div class="field">
            <label for="email">University email</label>
            <input class="input" id="email" type="email" placeholder="you@miu.edu.eg" required />
          </div>
          <div class="form-row">
            <div class="field">
              <label for="studentId">Student ID (optional)</label>
              <input class="input" id="studentId" placeholder="MIU-2024-0000" />
            </div>
            <div class="field">
              <label for="phone">Phone (optional)</label>
              <input class="input" id="phone" placeholder="01xxxxxxxxx" />
            </div>
          </div>
          <div class="field">
            <label for="password">Password (min 8 characters)</label>
            <input class="input" id="password" type="password" required />
          </div>
          <div class="form-error" id="formError" hidden></div>
          <button class="btn primary btn-block lg" type="submit">Create account</button>
        </form>
        <p class="small muted" style="margin-top:14px;text-align:center">
          Already have an account? <a href="#/login">Sign in</a>
        </p>
      </div>
    </div>`;

  view.querySelector('#regForm').onsubmit = async (e) => {
    e.preventDefault();
    const errEl = view.querySelector('#formError');
    errEl.hidden = true;
    const payload = {
      name: view.querySelector('#name').value.trim(),
      email: view.querySelector('#email').value.trim(),
      studentId: view.querySelector('#studentId').value.trim(),
      phone: view.querySelector('#phone').value.trim(),
      password: view.querySelector('#password').value,
    };
    try {
      const data = await api.post('/api/auth/register', payload);
      api.login(data.token, data.user);
      toast('Account created', 'Welcome to MIU QueueFlow 🎓', 'success');
      location.hash = '#/portal';
    } catch (err) {
      const details = err.details ? Object.values(err.details).join(', ') : null;
      errEl.textContent = details || err.message;
      errEl.hidden = false;
    }
  };
}
