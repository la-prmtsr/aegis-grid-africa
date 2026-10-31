import http from 'node:http';
import { spawn } from 'node:child_process';

const PORT = Number(process.env.PORT || 10000);

let backendRunning = false;
let shuttingDown = false;

const backend = spawn(
  process.execPath,
  ['src/v2/run.js', '--mock'],
  {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit'
  }
);

backendRunning = true;

const server = http.createServer((req, res) => {
  const pathname = new URL(
    req.url,
    'http://localhost'
  ).pathname;

  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'GET' && pathname === '/health') {
    res.writeHead(backendRunning ? 200 : 503);
    res.end(JSON.stringify({
      service: 'aegis-grid-bridge',
      mode: 'mock',
      running: backendRunning
    }));
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({
    error: 'Not found'
  }));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[hosting] HTTP server on port ${PORT}`);
});

function shutdown(signal = 'SIGTERM') {
  if (shuttingDown) return;
  shuttingDown = true;

  if (backendRunning) {
    backend.kill(signal);
  }

  server.close();
}

backend.on('exit', (code, signal) => {
  backendRunning = false;

  console.log(
    `[hosting] backend exited: ${code ?? signal}`
  );

  shutdown();
  process.exit(code === 0 ? 1 : (code ?? 1));
});

backend.on('error', (error) => {
  backendRunning = false;
  console.error('[hosting] backend error:', error);
  shutdown();
  process.exit(1);
});

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));