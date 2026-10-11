// API client + auth session store
const TOKEN_KEY = 'miu_queueflow_token';

export const api = {
  get token() { return localStorage.getItem(TOKEN_KEY); },
  set token(v) { v ? localStorage.setItem(TOKEN_KEY, v) : localStorage.removeItem(TOKEN_KEY); },

  get user() {
    try { return JSON.parse(localStorage.getItem('miu_queueflow_user') || 'null'); }
    catch { return null; }
  },
  set user(v) { v ? localStorage.setItem('miu_queueflow_user', JSON.stringify(v)) : localStorage.removeItem('miu_queueflow_user'); },

  async request(method, path, body) {
    const headers = { 'Content-Type': 'application/json' };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    const res = await fetch(path, {
      method, headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try { data = await res.json(); } catch { /* non-JSON */ }
    if (!res.ok) {
      const err = new Error(data?.error || `Request failed (${res.status})`);
      err.status = res.status;
      err.details = data?.details;
      throw err;
    }
    return data;
  },

  get: (p) => api.request('GET', p),
  post: (p, b) => api.request('POST', p, b),
  put: (p, b) => api.request('PUT', p, b),
  del: (p) => api.request('DELETE', p),

  login(token, user) { this.token = token; this.user = user; socket.emit('auth', token); },
  logout() { this.token = null; this.user = null; socket.disconnect().connect(); },
};

export const socket = io({ autoConnect: true, reconnection: true, reconnectionDelay: 1500 });

socket.on('connect', () => {
  document.getElementById('connDot')?.classList.remove('off');
  if (api.token) socket.emit('auth', api.token);
});
socket.on('disconnect', () => {
  document.getElementById('connDot')?.classList.add('off');
});

export function subscribe(...rooms) { socket.emit('subscribe', ...rooms); }
export function unsubscribe(...rooms) { socket.emit('unsubscribe', ...rooms); }
