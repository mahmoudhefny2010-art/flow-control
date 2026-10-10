// ---------------------------------------------------------------------------
// LEGACY SYSTEM INTEGRATION CLIENT
// ---------------------------------------------------------------------------
// Talks to the EXISTING queue system over HTTP (REST), exactly like an
// integration with an external platform. In development the base URL points
// at the built-in mock (LEGACY_API_BASE unset => http://127.0.0.1:<port>/api/legacy).
//
// NOTE: uses node:http rather than global fetch, because undici's fetch
// blocks "bad ports" per the WHATWG URL spec (e.g. port 11) — node:http
// works with any port the legacy system may use.
// ---------------------------------------------------------------------------
const http = require('http');
const https = require('https');
const config = require('../config');

class LegacyClient {
  constructor(baseUrl, port) {
    this.base = (baseUrl || `http://127.0.0.1:${port}/api/legacy`).replace(/\/$/, '');
    this.apiKey = config.legacyApiKey;
    const parsed = new URL(this.base);
    this.protocol = parsed.protocol;
    this.hostname = parsed.hostname;
    this.port = parsed.port || (parsed.protocol === 'https:' ? 443 : 80);
    this.prefix = parsed.pathname;
  }

  request(method, path, body) {
    return new Promise((resolve, reject) => {
      const lib = this.protocol === 'https:' ? https : http;
      const payload = body ? JSON.stringify(body) : null;
      const req = lib.request(
        {
          hostname: this.hostname,
          port: this.port,
          path: `${this.prefix}${path}`,
          method,
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': this.apiKey,
            ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
          },
          timeout: 8000,
        },
        (res) => {
          let raw = '';
          res.on('data', (chunk) => { raw += chunk; });
          res.on('end', () => {
            let data = {};
            try { data = raw ? JSON.parse(raw) : {}; } catch { /* non-JSON */ }
            if (res.statusCode >= 400) {
              const err = new Error(data.error || `Legacy API error ${res.statusCode}`);
              err.status = res.statusCode;
              err.data = data;
              reject(err);
              return;
            }
            resolve(data);
          });
        },
      );
      req.on('timeout', () => {
        req.destroy(new Error('Legacy API request timed out'));
      });
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
  }

  health() {
    return this.request('GET', '/health');
  }

  listQueues() {
    return this.request('GET', '/queues');
  }

  queueTickets(queueId) {
    return this.request('GET', `/queues/${queueId}/tickets`);
  }

  createTicket(queueId, { studentId, priority }) {
    return this.request('POST', `/queues/${queueId}/tickets`, { studentId, priority });
  }

  callTicket(ticketId) {
    return this.request('POST', `/tickets/${ticketId}/call`);
  }

  serveTicket(ticketId) {
    return this.request('POST', `/tickets/${ticketId}/serve`);
  }
}

module.exports = { LegacyClient };
