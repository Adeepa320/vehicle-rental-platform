/**
 * Runs the built background worker (`apps/api/dist/worker.js`) and exposes a tiny
 * HTTP health endpoint so Playwright's `webServer` can wait for it and detect a
 * crash: the worker itself has no port. 200 while the child is alive, 503 after
 * it exited. Killing this process kills the worker too.
 *
 * Environment: E2E_API_DIR (cwd of the worker), E2E_WORKER_HEALTH_PORT.
 */
import { spawn } from 'node:child_process';
import http from 'node:http';

const apiDir = process.env.E2E_API_DIR;
const port = Number(process.env.E2E_WORKER_HEALTH_PORT ?? 4710);
if (!apiDir) {
  console.error('E2E_API_DIR is required');
  process.exit(2);
}

const child = spawn(process.execPath, ['dist/worker.js'], {
  cwd: apiDir,
  env: process.env,
  stdio: 'inherit',
  windowsHide: true,
});

const server = http.createServer((_request, response) => {
  if (child.exitCode === null && child.signalCode === null) {
    response.writeHead(200, { 'content-type': 'text/plain' }).end('worker running');
  } else {
    response.writeHead(503, { 'content-type': 'text/plain' }).end('worker exited');
  }
});
server.listen(port, '127.0.0.1');

child.on('exit', (code, signal) => {
  console.error(`[e2e] worker exited (code ${code ?? 'null'}, signal ${signal ?? 'null'})`);
  server.close();
  process.exit(code ?? 1);
});

const stop = () => {
  if (child.exitCode === null) child.kill();
  server.close();
  process.exit(0);
};
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) process.on(signal, stop);
