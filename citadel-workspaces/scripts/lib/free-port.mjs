/**
 * Ports for the browser gates' servers, chosen at run time.
 *
 * Each gate had a fixed port (4173-4206) with `--strictPort`, so two runs of the same gate -- two
 * lanes, two worktrees, a gate and its own control -- collided, and the second died with "port
 * is already in use". Nothing is retried: a collision still fails loudly, it just has no fixed
 * port left to collide on.
 */
import { createServer } from 'node:net';

/** A port the OS has just handed out as free, for a server spawned in another process. */
export function freePort() {
  return new Promise((ok, fail) => {
    const probe = createServer();
    probe.once('error', fail);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => ok(port));
    });
  });
}

/** The port an in-process server bound when asked for port 0 (Vite's `preview()` result). */
export function boundPort(server) {
  const address = server.httpServer?.address();
  if (address === null || typeof address !== 'object') throw new Error('the preview server is not listening on a TCP port');
  return address.port;
}
