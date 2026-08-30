#!/usr/bin/env node
/**
 * "No workspace found" is a sentinel the client matches on, written by a server
 * that does not know it is one.
 *
 * `useMessageEventSetup.ts` decides whether to offer workspace initialization
 * like this:
 *
 *   const needsInitialization = payload.message.includes(WORKSPACE_MISSING_ERROR);
 *
 * `WORKSPACE_MISSING_ERROR` is `'No workspace found'`, declared in that file.
 * The string it is matching comes from the kernel:
 *
 *   NetworkError::msg("No workspace found for user")
 *
 * Nothing binds them. The Rust side reads as an ordinary human-facing error
 * message — nothing at that call site says a client is parsing it — so the
 * ordinary act of rewording it ("Workspace not found for user", "No workspace
 * for this account") makes `needsInitialization` false forever. The first user
 * of a fresh deployment is then never offered initialization, and nothing
 * fails: the app simply shows an error where the setup flow should be.
 *
 * That is the same shape as the transfer cap and the peer-list timeout, and it
 * gets the same treatment. Both sides are read as TEXT: a gate that imported
 * either would pass whatever the other said.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const TS_FILE = 'citadel-workspaces/src/components/hooks/useMessageEventSetup.ts';
const KERNEL_SRC = 'citadel-workspace-server-kernel/src';

function read(path) {
  try {
    return readFileSync(join(ROOT, path), 'utf8');
  } catch {
    console.error(`check-workspace-missing-parity: cannot read ${path}; nothing was compared.`);
    process.exit(1);
  }
}

const tsSource = read(TS_FILE);
const tsMatch = tsSource.match(/const WORKSPACE_MISSING_ERROR:[^=]*=\s*'([^']+)'/);
if (!tsMatch) {
  console.error(
    `check-workspace-missing-parity: no WORKSPACE_MISSING_ERROR declaration in ${TS_FILE}.\n` +
      'It was renamed or reshaped — this comparison cannot be trusted, so it fails\n' +
      'rather than reporting agreement it did not check.',
  );
  process.exit(1);
}
const sentinel = tsMatch[1];

// Every error message the kernel can produce, not one file and one call site.
//
// The first draft pinned a file and took the first workspace-ish match in it.
// That file has four `NetworkError::msg` literals mentioning a workspace, and
// the regex found "Workspace not found" three hundred lines above the one that
// matters — a gate reporting a break that was not there. A gate that cries wolf
// gets deleted, so it searches for the sentinel rather than guessing where it is.
function messagesUnder(dir) {
  const found = [];
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) found.push(...messagesUnder(rel));
    else if (entry.name.endsWith('.rs')) {
      for (const m of read(rel).matchAll(/NetworkError::msg\("([^"]+)"\)/g)) {
        found.push([rel, m[1]]);
      }
    }
  }
  return found;
}

const messages = messagesUnder(KERNEL_SRC);
if (messages.length === 0) {
  console.error(
    `check-workspace-missing-parity: no NetworkError::msg literals under ${KERNEL_SRC}.\n` +
      'The error construction was reshaped — this comparison cannot be trusted.',
  );
  process.exit(1);
}

const producer = messages.find(([, text]) => text.includes(sentinel));
if (!producer) {
  const nearby = messages.filter(([, t]) => /workspace/i.test(t)).slice(0, 8);
  console.error(
    '\ncheck-workspace-missing-parity: the client matches a string no kernel error contains.\n\n' +
      `  client expects to find: ${JSON.stringify(sentinel)}\n` +
      `           in ${TS_FILE}\n\n` +
      '  workspace messages the kernel actually produces:\n' +
      nearby.map(([f, t]) => `    ${JSON.stringify(t)}  (${f})`).join('\n') +
      '\n\n  needsInitialization is false whenever these disagree, so the first user of a\n' +
      '  fresh deployment is never offered workspace initialization — and nothing fails.\n' +
      '  Change one to agree with the other.\n',
  );
  process.exit(1);
}

console.log(
  `  Workspace-missing sentinel: ${JSON.stringify(sentinel)} produced by ${producer[0]}  ok`,
);
