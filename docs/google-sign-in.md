# Google sign-in setup

Create a Web application OAuth client in Google Cloud and configure its consent screen.
Register this exact redirect URI for local development:

    http://localhost:3000/api/auth/google/callback

Add these values to your local `.env` (never commit the secret):

    GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
    GOOGLE_CLIENT_SECRET=your-client-secret
    GOOGLE_REDIRECT_URI=http://localhost:3000/api/auth/google/callback

Restart the server. For production, register your HTTPS callback URL and use it
as GOOGLE_REDIRECT_URI. Set NODE_ENV=production and a strong JWT_SECRET.

New Google users receive student accounts. Existing password accounts are not
automatically linked by email; they must continue using their password. Disabled
accounts cannot sign in. Google accounts do not receive a local password.

OAuth attempts and one-use login sessions are stored in memory, expire quickly,
and require the browser's HttpOnly cookie. Use shared storage before running
multiple server instances. Server restarts invalidate pending login attempts.

Reference: https://developers.google.com/identity/openid-connect/openid-connect
