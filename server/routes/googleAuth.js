const crypto = require('crypto');
const { createRouter } = require('../lib/asyncRouter');
const { signToken } = require('../lib/auth');
const config = require('../config');

const router = createRouter();
const attempts = new Map();
const sessions = new Map();
const cookieOptions = { httpOnly: true, sameSite: 'lax', secure: config.nodeEnv === 'production', path: '/api/auth/google' };
const random = () => crypto.randomBytes(32).toString('base64url');
const configured = () => Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REDIRECT_URI);
const cookie = (req, name) => (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(`${name}=`))?.slice(name.length + 1);
const sweep = setInterval(() => {
  for (const map of [attempts, sessions]) for (const [key, value] of map) if (value.expires < Date.now()) map.delete(key);
}, 60000);
sweep.unref();

router.get('/config', (req, res) => res.json({ enabled: configured() }));

router.get('/start', (req, res) => {
  if (!configured()) return res.redirect('/#/login?googleError=unavailable');
  if (attempts.size >= 10000) return res.redirect('/#/login?googleError=failed');
  const state = random();
  const verifier = random();
  attempts.set(state, { verifier, expires: Date.now() + 10 * 60 * 1000 });
  res.cookie('google_state', state, { ...cookieOptions, maxAge: 10 * 60 * 1000 });
  const query = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: process.env.GOOGLE_REDIRECT_URI,
    response_type: 'code', scope: 'openid email profile', state,
    code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256', prompt: 'select_account',
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${query}`);
});

router.get('/callback', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const state = cookie(req, 'google_state');
  const attempt = attempts.get(state);
  attempts.delete(state);
  res.clearCookie('google_state', cookieOptions);
  if (!configured() || !attempt || attempt.expires < Date.now() || req.query.state !== state) {
    return res.redirect('/#/login?googleError=failed');
  }
  if (req.query.error || typeof req.query.code !== 'string') return res.redirect('/#/login?googleError=cancelled');
  try {
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', signal: AbortSignal.timeout(15000),
      body: new URLSearchParams({ code: req.query.code, client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET, redirect_uri: process.env.GOOGLE_REDIRECT_URI,
        grant_type: 'authorization_code', code_verifier: attempt.verifier }),
    });
    if (!tokenResponse.ok) throw new Error('Token exchange failed');
    const tokens = await tokenResponse.json();
    if (!tokens.access_token) throw new Error('Missing access token');
    const profileResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` }, signal: AbortSignal.timeout(15000),
    });
    if (!profileResponse.ok) throw new Error('Profile unavailable');
    const profile = await profileResponse.json();
    if (!profile.sub || !profile.email || profile.email_verified !== true) throw new Error('Unverified identity');
    const store = req.app.get('store');
    let user = await store.findOne('users', { googleId: profile.sub });
    if (!user) {
      const email = profile.email.toLowerCase();
      const existing = await store.findOne('users', { email });
      // Never silently link a password account (including staff) by email.
      if (existing) return res.redirect('/#/login?googleError=existing');
      user = { _id: crypto.randomUUID(), googleId: profile.sub, name: profile.name || email.split('@')[0],
        email, role: 'student', studentId: '', phone: '', active: true,
        preferences: { emailNotifications: true }, createdAt: new Date().toISOString() };
      await store.insert('users', user);
    }
    if (user.active === false) return res.redirect('/#/login?googleError=disabled');
    const session = random();
    sessions.set(session, { userId: user._id, expires: Date.now() + 60000 });
    res.cookie('google_session', session, { ...cookieOptions, maxAge: 60000 });
    return res.redirect('/#/login?google=success');
  } catch {
    return res.redirect('/#/login?googleError=failed');
  }
});

router.post('/session', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const key = cookie(req, 'google_session');
  const session = sessions.get(key);
  sessions.delete(key);
  res.clearCookie('google_session', cookieOptions);
  if (!session || session.expires < Date.now()) return res.status(401).json({ error: 'Google sign-in expired. Please try again.' });
  const user = await req.app.get('store').findOne('users', { _id: session.userId });
  if (!user || user.active === false) return res.status(401).json({ error: 'Account unavailable.' });
  const { passwordHash, googleId, ...publicUser } = user;
  res.json({ token: signToken(user), user: publicUser });
});

module.exports = router;
