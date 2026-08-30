#!/usr/bin/env node
/**
 * Verify the running stack is reachable FROM THIS MACHINE, not from inside a
 * container.
 *
 * `docker compose up -d --wait` exits 0 when every healthcheck passes — and
 * every healthcheck here probes `127.0.0.1` from inside its own container:
 *
 *   test: [ "CMD", "nc", "-z", "127.0.0.1", "12349" ]
 *
 * With `network_mode: host` (which all five dev services use) that loopback is
 * the DOCKER VM's on macOS and Windows, not the host's. The compose file for
 * the local stack explains this at length — "Port 8080 is then bound inside the
 * VM and http://localhost:8080 in your browser reaches nothing" — but the dev
 * stack the README leads with carries no such warning, and its healthchecks
 * cannot detect the condition they are inside of.
 *
 * So the documented first command on a clean macOS machine prints success and
 * leaves a stack the browser cannot reach, with no diagnostic anywhere. This
 * checks the thing the user actually cares about: can a request from here reach
 * the app.
 *
 * Deliberately not a healthcheck. A container cannot answer this question about
 * itself; only something outside can.
 */

import net from 'node:net';

const TARGETS = [
  { name: 'UI', url: 'http://127.0.0.1:5291/', hint: 'the app itself' },
  { name: 'internal service', url: 'http://127.0.0.1:12345/', hint: 'the local agent', tcpOnly: true },
];

const TIMEOUT_MS = 4000;

/**
 * A raw TCP connect, not an HTTP request.
 *
 * This used to fetch() the port and decide from the error TEXT whether the
 * failure was a refused connection or a protocol mismatch — treating anything
 * unmatched as proof the port was open. undici puts ECONNREFUSED in
 * `error.cause` and sets `error.message` to the constant "fetch failed", so the
 * regex never matched and a REFUSED connection returned reachable. The one
 * guard for the documented macOS blind spot could not fail on the condition it
 * was written to catch.
 *
 * Connecting a socket answers the actual question — is anything listening —
 * with no error strings to misread, and works for a WebSocket-only port that
 * would never speak HTTP.
 */
function tcpReachable(host, port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const settle = (result) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(TIMEOUT_MS);
    socket.once('connect', () => settle({ ok: true }));
    socket.once('timeout', () => settle({ ok: false, message: `no response within ${TIMEOUT_MS}ms` }));
    socket.once('error', (error) => settle({ ok: false, message: error.message }));
  });
}

async function reachable({ url, tcpOnly }) {
  const { hostname, port, protocol } = new URL(url);
  const resolvedPort = Number(port || (protocol === 'https:' ? 443 : 80));

  if (tcpOnly) return tcpReachable(hostname, resolvedPort);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    await fetch(url, { signal: controller.signal });
    return { ok: true };
  } catch (error) {
    // Report the cause when there is one: "fetch failed" alone tells the reader
    // nothing about which of the several possible failures happened.
    const detail = error?.cause ?? error;
    return { ok: false, message: detail instanceof Error ? detail.message : String(detail) };
  } finally {
    clearTimeout(timer);
  }
}

const failures = [];
for (const target of TARGETS) {
  const result = await reachable(target);
  if (result.ok) {
    console.log(`  reachable: ${target.name} (${target.url})`);
  } else {
    failures.push({ ...target, message: result.message });
  }
}

if (failures.length > 0) {
  console.error('\nThe stack reports healthy but is not reachable from this machine:\n');
  for (const f of failures) {
    console.error(`  ${f.name} — ${f.url} (${f.hint})`);
  }
  console.error(
    '\nOn macOS and Windows this is almost always Docker host networking.\n' +
      'Every dev service uses `network_mode: host`, so the ports are bound inside\n' +
      "Docker's VM rather than on your machine. Docker Desktop has an opt-in\n" +
      'host-networking mode (Settings > Resources > Network) which must be enabled\n' +
      'by hand, or use docker-compose.local.yml, which does not rely on it.\n\n' +
      'The containers ARE healthy — their healthchecks probe 127.0.0.1 from inside\n' +
      'themselves, which is why `--wait` succeeded.'
  );
  process.exit(1);
}

console.log('\nStack is reachable from this machine.');
