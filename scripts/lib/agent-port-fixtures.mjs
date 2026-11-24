/**
 * Where test code may name the agent's own port, and why nothing there binds or dials it
 * (scripts/check-tests-never-use-the-agent-port.mjs). Each entry is a file and the exact number of
 * uses the gate finds in it: a new use in a listed file fails like one anywhere else.
 */
const A = 'citadel-internal-service/';
const NET = `${A}citadel-internal-service/src/kernel/apps/net/tests/`;
const UPDATER = `${A}citadel-internal-service/src/updater/`;

const REFUSED = 'the address the egress policy must refuse, decided as a pure verdict; no connector';
const NET_WORLD = 'the host egress world under test, with a fake resolver and connector: the agent port is what its policy refuses';
const URL_TEXT = 'a URL or command parsed or rendered as text; no socket';

const entries = [
  [`${A}citadel-app-net-policy/src/tests/hard_deny_tests.rs`, 5, REFUSED],
  [`${A}citadel-app-net-policy/src/tests/redirect_tests.rs`, 1, REFUSED],
  [`${NET}allowed.rs`, 1, NET_WORLD],
  [`${NET}authority.rs`, 1, NET_WORLD],
  [`${NET}denied.rs`, 2, NET_WORLD],
  [`${NET}lifecycle.rs`, 1, NET_WORLD],
  [`${NET}mod.rs`, 1, NET_WORLD],
  [`${NET}private_network.rs`, 2, NET_WORLD],
  [`${A}citadel-internal-service/src/telemetry/core/browser_tests.rs`, 1, 'a log line the redactor rewrites'],
  [`${UPDATER}launch_settings_tests.rs`, 1, 'launch settings parsed from text; no process'],
  [`${UPDATER}swap.rs`, 3, 'the relaunch command given to a shell-script stand-in that only records its arguments; install() never runs'],
  [`${UPDATER}watchdog_tests.rs`, 6, 'the watchdog against a fake WatchIo, which records each spawn and health probe instead of performing it'],
  [`${A}citadel-internal-service/tests/updater_launch_settings.rs`, 4, "the old agent's command, given to a shell-script stand-in that writes its plan down and exits; nothing is supervised or probed"],
  [`${A}citadel-internal-service/tests/updater_platforms.rs`, 1, 'an UpdaterConfig the installer choice reads; nothing is started'],
  [`${A}citadel-internal-service/tests/common/src/ports.rs`, 2, 'the compile-time guard that refuses a test port range containing the agent port; nothing binds or dials it'],
  ['citadel-workspace-internal-service/src/app_net.rs', 1, 'a pure config function, asserted on'],
  ['citadel-workspace-internal-service/src/update_setup.rs', 3, 'a pure config function, asserted on'],
  ['citadel-workspaces/src/components/agent-setup/__tests__/AgentSetup.test.tsx', 3, URL_TEXT],
  ['citadel-workspaces/src/lib/__tests__/agent-download.test.ts', 3, URL_TEXT],
  ['citadel-workspaces/src/lib/websocket-service/__tests__/resolve-url.test.ts', 5, URL_TEXT],
  ['citadel-workspaces/src/lib/websocket/__tests__/a-delivered-message-is-not-broadcast-again.test.ts', 1, 'a URL handed to a mocked client-ts; nothing dials'],
  ['citadel-workspaces/vite.config.ts', 1, "the dev server's /ws proxy to the developer's own agent; every gate serving through this config pins AGENT_PORT (lib/preview-world.mjs, check-agent-down.mjs; enforced by check-gates-pin-their-world.mjs)"],
  ['deploy/tenant-worker/test/ui.test.mjs', 1, 'the published loopback origin rendered into a page; text'],
  ['scripts/check-the-loopback-agent-origin-is-wired.mjs', 8, 'values rendered into the nginx template and handed to its shape validator (16-validate-runtime-vars.sh), which dials nothing'],
  ['scripts/prove-mistakes-are-explained.mjs', 1, 'an instruction it prints'],
];

export const ALLOWED = new Map(entries.map(([path, uses, why]) => [path, { uses, why }]));

/** Gates that exist to dial the developer's running stack: run by hand only, never by a hook or CI. */
export const DIALS_THE_STACK = new Map([
  ['scripts/check-stack-reachable.mjs', { uses: 1, why: 'asks whether the running stack is reachable from this machine (`npm run check:stack`)' }],
]);
