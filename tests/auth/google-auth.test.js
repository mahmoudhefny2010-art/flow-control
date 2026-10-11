const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

test('Google login validates state, creates students, and consumes sessions once', async () => {
  process.env.GOOGLE_CLIENT_ID = 'test-client';
  process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
  process.env.GOOGLE_REDIRECT_URI = 'http://localhost/api/auth/google/callback';
  const app = express();
  const users = [];
  app.set('store', {
    findOne: async (_, query) => users.find(user => Object.entries(query).every(([key, value]) => user[key] === value)),
    insert: async (_, user) => users.push(user),
  });
  app.use('/api/auth/google', require('../../server/routes/googleAuth'));
  const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  const nativeFetch = global.fetch;
  let googleCalls = 0;
  global.fetch = async (url, options) => {
    googleCalls++;
    if (url === 'https://oauth2.googleapis.com/token') {
      assert.equal(options.body.get('client_secret'), 'test-secret');
      assert.ok(options.body.get('code_verifier'));
      return { ok: true, json: async () => ({ access_token: 'google-access' }) };
    }
    assert.equal(url, 'https://openidconnect.googleapis.com/v1/userinfo');
    return { ok: true, json: async () => ({ sub: 'google-user', email: 'student@example.com', email_verified: true, name: 'Student' }) };
  };
  const request = (path, options = {}) => nativeFetch(`http://127.0.0.1:${server.address().port}/api/auth/google${path}`, { redirect: 'manual', ...options });
  const begin = async () => {
    const response = await request('/start');
    const url = new URL(response.headers.get('location'));
    assert.equal(url.origin, 'https://accounts.google.com');
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    return { state: url.searchParams.get('state'), cookie: response.headers.get('set-cookie').split(';')[0] };
  };
  const complete = async () => {
    const attempt = await begin();
    return request(`/callback?state=${attempt.state}&code=test-code`, { headers: { Cookie: attempt.cookie } });
  };
  try {
    const bad = await request('/callback?state=forged&code=test');
    assert.equal(bad.headers.get('location'), '/#/login?googleError=failed');
    assert.equal(googleCalls, 0);
    const attempt = await begin();
    const cancelled = await request(`/callback?state=${attempt.state}&error=access_denied`, { headers: { Cookie: attempt.cookie } });
    assert.match(cancelled.headers.get('location'), /cancelled/);
    const success = await complete();
    assert.equal(success.headers.get('location'), '/#/login?google=success');
    assert.equal(users.length, 1);
    assert.equal(users[0].role, 'student');
    const sessionCookie = success.headers.get('set-cookie').match(/google_session=([^;]+)/)[0];
    const session = await request('/session', { method: 'POST', headers: { Cookie: sessionCookie } });
    const data = await session.json();
    assert.ok(data.token);
    assert.equal(data.user.googleId, undefined);
    assert.equal((await request('/session', { method: 'POST', headers: { Cookie: sessionCookie } })).status, 401);
    users[0].active = false;
    assert.match((await complete()).headers.get('location'), /disabled/);
    users[0].active = true;
    delete users[0].googleId;
    assert.match((await complete()).headers.get('location'), /existing/);
    assert.equal(users.length, 1);
    delete process.env.GOOGLE_CLIENT_ID;
    assert.deepEqual(await (await request('/config')).json(), { enabled: false });
  } finally {
    global.fetch = nativeFetch;
    await new Promise(resolve => server.close(resolve));
  }
});
