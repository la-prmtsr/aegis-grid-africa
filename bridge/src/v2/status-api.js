// Read-only trade status API for Stage 5B.3, on 127.0.0.1 only (not exposed to the network).
//   GET /health        backend mode and counts
//   GET /trades        recent trades, newest first
//   GET /trades/:id    one trade (escrow id)
import http from 'node:http';

export function startStatusApi({ port, health, trades, log }) {
  const server = http.createServer((req, res) => {
    const send = (code, body) => {
      res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify(body, null, 2));
    };
    if (req.method !== 'GET') return send(405, { error: 'read-only API: GET only' });
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/health') return send(200, health());
    if (url.pathname === '/trades') return send(200, trades());
    const m = url.pathname.match(/^\/trades\/(\d+)$/);
    if (m) {
      const t = trades().find((x) => x.id === Number(m[1]));
      return t ? send(200, t) : send(404, { error: `trade ${m[1]} not known to this backend` });
    }
    return send(404, { error: 'not found' });
  });
  server.on('error', (err) => log(`status API not started: ${err.message}`));
  server.listen(port, '127.0.0.1', () => log(`read-only status API on http://127.0.0.1:${port}/trades`));
  return server;
}
