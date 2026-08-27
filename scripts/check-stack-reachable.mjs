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

const TARGETS = [
  { name: 'UI', url: 'http://127.0.0.1:5291/', hint: 'the app itself' },
  { name: 'internal service', url: 'http://127.0.0.1:12345/', hint: 'the local agent', tcpOnly: true },
];

const TIMEOUT_MS = 4000;

async function reachable({ url, tcpOnly }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    await fetch(url, { signal: controller.signal });
    return { ok: true };
  } catch (error) {
    // A WebSocket-only port answers an HTTP request with a protocol error
    // rather than a connection error — which still proves the port is open.
    const message = error instanceof Error ? error.message : String(error);
    if (tcpOnly && !/ECONNREFUSED|abort|timeout/i.test(message)) return { ok: true };
    return { ok: false, message };
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
