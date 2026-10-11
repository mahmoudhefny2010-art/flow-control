// Auth views: login + register
import { api } from '../api.js';
import { toast, escapeHtml } from '../ui.js';

export function renderLogin(view, params) {
  const redirect = params.get('redirect');
  view.innerHTML = `
    <div class="auth-wrap">
      <div class="card auth-card">
        <h1>Welcome back</h1>
        <div class="sub">Sign in to MIU QueueFlow</div>
        <form id="loginForm" novalidate>
          <div class="field">
            <label for="identifier">MIU ID or university email</label>
            <input class="input" id="identifier" type="text" placeholder="2024/06700 or you@miu.edu.eg" required autocomplete="username" />
          </div>
          <div class="field">
            <label for="password">Password</label>
            <input class="input" id="password" type="password" placeholder="••••••••" required autocomplete="current-password" />
          </div>
          <div class="form-error" id="formError" hidden></div>
          <button class="btn primary btn-block lg" type="submit">Sign in</button>
        </form>
        <div class="auth-divider"><span>OR</span></div>
        <button class="google-sign-in" id="googleSignIn" type="button">
          <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
            <path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-1.99 3.02v2.51h3.23c1.89-1.74 2.98-4.3 2.98-7.36z"/>
            <path fill="#34A853" d="M12 22c2.7 0 4.96-.9 6.62-2.41l-3.23-2.51c-.9.6-2.05.96-3.39.96-2.61 0-4.82-1.76-5.61-4.12H3.05v2.59A10 10 0 0 0 12 22z"/>
            <path fill="#FBBC05" d="M6.39 13.92a6 6 0 0 1 0-3.84V7.49H3.05a10 10 0 0 0 0 9.02l3.34-2.59z"/>
            <path fill="#EA4335" d="M12 5.96c1.47 0 2.79.51 3.83 1.51l2.87-2.87A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.95 5.49l3.34 2.59C7.18 7.72 9.39 5.96 12 5.96z"/>
          </svg>
          <span>Sign in with Google</span>
        </button>
        <p class="form-error" id="googleError" role="alert" hidden></p>
        <p class="small muted" style="margin-top:14px;text-align:center">
          New to QueueFlow? <a href="#/register">Create a student account</a>
        </p>
      </div>
    </div>`;

  const googleError = view.querySelector('#googleError');
  const showGoogleError = (message) => { googleError.textContent = message; googleError.hidden = false; };
  const googleErrors = {
    unavailable: 'Google sign-in is not configured yet. Please use your MIU ID or email.',
    failed: 'Google sign-in could not be completed. Please try again.',
    cancelled: 'Google sign-in was cancelled. You can try again.',
    existing: 'This email already has an account. Please sign in with your existing password.',
    disabled: 'This account is disabled. Please contact support.',
  };
  if (params.has('googleError')) showGoogleError(googleErrors[params.get('googleError')] || googleErrors.failed);
  view.querySelector('#googleSignIn').onclick = async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    googleError.hidden = true;
    try {
      const { enabled } = await api.get('/api/auth/google/config');
      if (!enabled) { showGoogleError(googleErrors.unavailable); return; }
      if (redirect?.startsWith('#/')) sessionStorage.setItem('googleLoginRedirect', redirect);
      else sessionStorage.removeItem('googleLoginRedirect');
      location.assign('/api/auth/google/start');
    } catch (error) { showGoogleError(error.message); }
    finally { button.disabled = false; }
  };
  if (params.get('google') === 'success') {
    history.replaceState(null, '', `${location.pathname}#/login`);
    api.post('/api/auth/google/session', {}).then(data => {
      api.login(data.token, data.user);
      const destination = sessionStorage.getItem('googleLoginRedirect');
      sessionStorage.removeItem('googleLoginRedirect');
      location.hash = destination?.startsWith('#/') ? destination : '#/portal';
    }).catch(error => showGoogleError(error.message));
  }

  view.querySelector('#loginForm').onsubmit = async (e) => {
    e.preventDefault();
    const errEl = view.querySelector('#formError');
    errEl.hidden = true;
    const identifier = view.querySelector('#identifier').value.trim();
    const password = view.querySelector('#password').value;
    try {
      const data = await api.post('/api/auth/login', { identifier, password });
      api.login(data.token, data.user);
      toast(`Welcome, ${data.user.name.split(' ')[0]}`, 'Signed in successfully', 'success');
      const dashboards = {
        admin: '#/admin',
        employee: '#/employee',
        'outside-usher': '#/outside',
        'room-usher': '#/room',
        'registrar-staff': '#/registrar',
        student: '#/portal',
      };
      location.hash = redirect?.startsWith('#') ? redirect : (dashboards[data.user.role] || '#/portal');
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
              <input class="input" id="studentId" placeholder="2024/06700" />
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
