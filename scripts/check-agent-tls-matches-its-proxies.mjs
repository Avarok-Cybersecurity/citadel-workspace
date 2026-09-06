#!/usr/bin/env node
/**
 * The agent's transport, and the transport everything that fronts it dials,
 * must be the same one.
 *
 * There are two topologies and they disagree by design:
 *
 *   - The binary a user downloads is dialled DIRECTLY from an https page, at
 *     `wss://local.avarok.net:12345`. A secure context cannot open a `ws://`
 *     socket, so that agent must serve TLS. It is the default for exactly this
 *     reason.
 *   - In the container the agent is never dialled by a browser. nginx fronts it
 *     (`proxy_pass http://${AGENT_UPSTREAM}/`) and so does the Vite dev proxy
 *     (`target: ws://127.0.0.1:...`). Both speak plaintext to it over loopback,
 *     inside the trust boundary check-agent-binds-loopback.mjs describes.
 *
 * Written because it happened. TLS became the agent's default and neither proxy
 * was changed, so both dialled a plaintext socket at a TLS listener. The failure
 * gives you nothing to go on: the agent is running, the port is open, the proxy
 * reports no error, and the browser says `1006 Connection closed before
 * receiving a handshake response`. Every dev and CI path through the containers
 * was broken at once, and no gate here could see it, because the two halves of
 * the contract lived in three files nothing read together.
 *
 * The rule is deliberately about AGREEMENT, not about a preferred mode. Moving
 * the proxy hop to TLS is a legitimate choice; making it silently is not. So:
 *
 *   1. Every launch site must STATE its mode -- `--no-tls` or `--tls-cert`.
 *      Inheriting the default is what broke, and a default that is right for
 *      one topology is wrong for the other, so neither may be assumed.
 *   2. Every proxy that fronts the agent must dial the mode its agent serves.
 *
 * WHAT THIS DOES NOT COVER: the direct-dial topology has no proxy in this
 * repository to compare against -- the browser dials the released binary from a
 * page served elsewhere. scripts/smoke-agent.sh is what asserts that one, by
 * completing a real TLS handshake against the published release.
 */
import { readFileSync, existsSync } from 'node:fs';

const DOCKERFILE = 'docker/internal-service/Dockerfile';
const NGINX = 'docker/ui/nginx.conf.template';
// The Vite config lives in the UI submodule. Both paths are tried so the gate
// works from the parent repo and from a UI checkout; finding NEITHER is a
// failure, never a skip. A gate that quietly skips its own input is how a
// proxy scheme goes unread.
const VITE_PATHS = ['citadel-workspaces/vite.config.ts', 'vite.config.ts'];

const failures = [];
const read = (p) => readFileSync(p, 'utf8');

// ---- 1. Every launch site states its mode. ----
//
// Matches the binary being RUN, not the lines that merely NAME it. The first
// draft of this matched `--release -p citadel-workspace-internal-service --bin`
// and demanded a TLS flag on a `cargo build`, which is the kind of false
// positive that gets a gate deleted rather than fixed.
const BUILDS_OR_COPIES = /\b(?:cargo\s+(?:build|check|test)|COPY|RUN\s+cp|chown)\b/;
const launchLines = read(DOCKERFILE)
  .split('\n')
  .map((line, i) => ({ line, n: i + 1 }))
  .filter(({ line }) => /citadel-workspace-internal-service\s+--/.test(line))
  .filter(({ line }) => !BUILDS_OR_COPIES.test(line));

if (launchLines.length === 0) {
  failures.push(`${DOCKERFILE}: no agent launch command found — this gate has lost its subject`);
}

const agentServesTls = [];
for (const { line, n } of launchLines) {
  const noTls = /--no-tls\b/.test(line);
  const withCert = /--tls-cert\b/.test(line);
  if (noTls && withCert) {
    failures.push(`${DOCKERFILE}:${n}: states both --no-tls and --tls-cert`);
  } else if (!noTls && !withCert) {
    failures.push(
      `${DOCKERFILE}:${n}: launches the agent without stating a TLS mode. ` +
      `Add --no-tls (plaintext behind the proxy) or --tls-cert/--tls-key. ` +
      `The default is TLS, chosen for the direct-dial topology, and inheriting ` +
      `it here is what silently broke every proxied path.`);
  } else {
    agentServesTls.push({ n, tls: withCert });
  }
}

// ---- 2. Every proxy dials the mode its agent serves. ----
const proxies = [];

// nginx: the `location = /ws` block's upstream.
const nginx = read(NGINX);
const proxyPass = nginx.match(/proxy_pass\s+(https?):\/\/\$\{?AGENT_UPSTREAM\}?/);
if (!proxyPass) {
  failures.push(`${NGINX}: no proxy_pass to AGENT_UPSTREAM found — this gate has lost its subject`);
} else {
  proxies.push({ where: NGINX, tls: proxyPass[1] === 'https' });
}

const vitePath = VITE_PATHS.find((p) => existsSync(p));
if (!vitePath) {
  failures.push(`none of ${VITE_PATHS.join(', ')} exists — the Vite agent proxy could not be read`);
} else {
  const vite = read(vitePath);
  const target = vite.match(/target:\s*[`'"](wss?):\/\/127\.0\.0\.1:\$\{?[^`'"]*AGENT_PORT/);
  if (!target) {
    failures.push(`${vitePath}: no agent proxy target found — this gate has lost its subject`);
  } else {
    proxies.push({ where: vitePath, tls: target[1] === 'wss' });
  }
}

// Compare only when the launch sites agree with each other; if they do not,
// the first rule has already said so and a second message would just be noise.
const modes = new Set(agentServesTls.map((a) => a.tls));
if (modes.size > 1) {
  failures.push(`${DOCKERFILE}: launch commands disagree about TLS; they front the same proxies`);
} else if (modes.size === 1) {
  const served = [...modes][0];
  for (const proxy of proxies) {
    if (proxy.tls !== served) {
      failures.push(
        `${proxy.where} dials the agent over ${proxy.tls ? 'TLS' : 'plaintext'}, ` +
        `but ${DOCKERFILE} launches it with ${served ? 'TLS' : '--no-tls'}. ` +
        `A handshake across that mismatch fails as a bare 1006 with nothing in any log.`);
    }
  }
}

if (failures.length) {
  console.error('Agent TLS mode and its proxies disagree:\n');
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}
console.log(
  `Agent TLS mode is stated at ${launchLines.length} launch site(s) and matches ` +
  `${proxies.length} proxy target(s).`);
