// Optional development reverse proxy: 8080 -> configured app port.
// Socket.io falls back to long-polling through the proxy automatically.
// Usage: node scripts/dev-proxy.js
const http = require('http');

const TARGET_PORT = require('../server/config').port;
const PROXY_PORT = process.env.PROXY_PORT || 8080;

const proxy = http.createServer((req, res) => {
  const options = {
    hostname: '127.0.0.1',
    port: TARGET_PORT,
    path: req.url,
    method: req.method,
    headers: { ...req.headers, host: `127.0.0.1:${TARGET_PORT}` },
  };
  const upstream = http.request(options, (upRes) => {
    res.writeHead(upRes.statusCode, upRes.headers);
    upRes.pipe(res, { end: true });
  });
  upstream.on('error', (err) => {
    res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end(`Proxy error: ${err.message}`);
  });
  req.pipe(upstream);
});

proxy.listen(PROXY_PORT, () => {
  console.log(`Dev proxy: http://localhost:${PROXY_PORT} -> http://localhost:${TARGET_PORT}`);
});
