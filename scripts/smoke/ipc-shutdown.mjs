// Preloaded (`node --import`) into the API, worker and web processes started by
// `scripts/smoke-phase10.mjs`. Windows cannot deliver SIGTERM to a child process
// (Node terminates it instead), so the smoke asks for a graceful stop over the IPC
// channel: the message emits SIGTERM inside the process, which runs NestJS's
// shutdown hooks (`enableShutdownHooks`: database pool, pg-boss, HTTP server) or
// Next.js's own SIGTERM handler. NestJS ends its hook by re-sending the signal to
// itself, which on Windows would be a forced kill; once the graceful stop was
// requested that final self-signal becomes a normal exit 0 instead.
//
// Test harness only: never loaded by the production images.
if (typeof process.send === 'function') {
  let stopping = false;
  const kill = process.kill.bind(process);
  process.kill = (pid, signal) => {
    if (stopping && pid === process.pid) {
      console.log('[smoke] graceful shutdown completed');
      process.exit(0);
    }
    return kill(pid, signal);
  };
  process.on('message', (message) => {
    if (message !== 'smoke:shutdown' || stopping) return;
    stopping = true;
    console.log('[smoke] graceful shutdown requested');
    process.emit('SIGTERM', 'SIGTERM');
  });
  // The channel must not keep an otherwise finished process alive.
  process.channel?.unref();
}
