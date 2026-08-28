#!/usr/bin/env node
/**
 * The browser must not give up on peer discovery before the agent does.
 *
 * The agent bounds the whole peer-list operation at `PEER_LIST_TIMEOUT`; the
 * browser bounds its wait at `PEER_LIST_MS`. If the browser's is shorter, a
 * slow-but-working discovery is reported to the user as a failure and the real
 * answer arrives with nothing listening.
 *
 * It was: 6s against 30s. The TypeScript comment explained the value by citing
 * "the backend SDK timeout (5s)" — a statement about a Rust constant that had
 * been changed to 30s, with the comment left behind. A number justified by a
 * fact that stopped being true is the hardest kind to notice, because it reads
 * as considered.
 *
 * Both sides are read as TEXT, for the same reason as the transfer-cap gate:
 * importing either would pass whatever the other said.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const TS_FILE = 'citadel-workspaces/src/lib/timeout-constants.ts';
const RS_FILE =
  'citadel-internal-service/citadel-internal-service/src/kernel/requests/peer/mod.rs';

function read(path) {
  try {
    return readFileSync(join(ROOT, path), 'utf8');
  } catch {
    console.error(`check-peer-list-timeout-parity: cannot read ${path}; nothing was compared.`);
    process.exit(1);
  }
}

const tsMatch = read(TS_FILE).match(/PEER_LIST_MS:\s*(\d+)/);
const rsMatch = read(RS_FILE).match(
  /PEER_LIST_TIMEOUT:\s*Duration\s*=\s*Duration::from_secs\((\d+)\)/,
);

if (!tsMatch || !rsMatch) {
  console.error(
    'check-peer-list-timeout-parity: could not find both constants ' +
      `(ts=${Boolean(tsMatch)}, rs=${Boolean(rsMatch)}). One was renamed or reshaped, so\n` +
      'this comparison cannot be trusted and fails rather than reporting agreement.',
  );
  process.exit(1);
}

const browserMs = Number(tsMatch[1]);
const agentMs = Number(rsMatch[1]) * 1000;

if (browserMs <= agentMs) {
  console.error('The browser gives up on peer discovery before the agent does:\n');
  console.error(`  ${TS_FILE}\n    PEER_LIST_MS = ${browserMs} ms`);
  console.error(`  ${RS_FILE}\n    PEER_LIST_TIMEOUT = ${agentMs} ms\n`);
  console.error(
    'A slow-but-working discovery is then reported to the user as a failure,\n' +
      'and the real answer arrives with nothing listening. Raise PEER_LIST_MS\n' +
      'above the agent bound.',
  );
  process.exit(1);
}

console.log(
  `The browser waits ${browserMs} ms for peer discovery, past the agent's ${agentMs} ms bound.`,
);
