#!/usr/bin/env node
/**
 * A fan-out over listeners must not let one of them silence the rest.
 *
 * `listeners.forEach(l => l(x))` couples subscribers that have nothing to do
 * with each other. `forEach` propagates, so the first handler to throw does two
 * things at once: every LATER subscriber silently never learns the event
 * happened, and the throw unwinds into whatever triggered the notification —
 * usually a caller that was succeeding.
 *
 * On `notifyMessageListeners` that read as an inbound P2P message delivered to
 * some listeners and not others, with no error anywhere near the listener that
 * dropped it. In the client package it turned a successful login into a thrown
 * error while the other subscribers kept a stale session.
 *
 * `EventEmitter.emit` has always isolated its handlers in a try/catch, and
 * `user-service.ts` does too. Seven hand-rolled fan-outs did not — the correct
 * guard existed, documented, in the obvious central place, and the copies never
 * got it. That is why this is a gate and not a one-time fix.
 *
 * Use `notifyEach` (src/lib/notify-listeners.ts), or wrap the call in a
 * try/catch inside the loop body.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const UI_SRC = join(ROOT, 'citadel-workspaces', 'src');
const CLIENT_SRC = join(ROOT, 'citadel-workspace-client-ts', 'src');

/**
 * Files allowed to hand-roll the loop, because they ARE the guard.
 * Relative to the repo root so a move shows up as a failure rather than a
 * silently widened exemption.
 */
const IMPLEMENTS_THE_GUARD = new Set([
  'citadel-workspaces/src/lib/event-emitter.ts',
  'citadel-workspaces/src/lib/notify-listeners.ts',
  'citadel-workspaces/src/lib/user-service.ts',
  'citadel-workspace-client-ts/src/notify-listeners.ts',
]);

const FANOUT = /\b(\w*(?:[Ll]isteners|[Hh]andlers|[Cc]allbacks))\s*\.forEach\s*\(/;

function* sources(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
      yield* sources(full);
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      yield full;
    }
  }
}

const problems = [];
for (const dir of [UI_SRC, CLIENT_SRC]) {
  for (const file of sources(dir)) {
    const rel = relative(ROOT, file);
    if (IMPLEMENTS_THE_GUARD.has(rel)) continue;
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      const match = FANOUT.exec(line);
      if (!match) return;
      // A loop body that catches for itself is fine; so is one that is not
      // actually invoking the listener (a map/filter over the collection).
      const window = lines.slice(i, i + 6).join('\n');
      if (/\btry\s*\{/.test(window)) return;
      problems.push(`${rel}:${i + 1}  ${match[1]}.forEach(...)`);
    });
  }
}

if (problems.length > 0) {
  console.error('Listener fan-outs that let one subscriber silence the rest:\n');
  for (const p of problems) console.error(`  - ${p}`);
  console.error(
    `\n${problems.length} problem(s). Use notifyEach (lib/notify-listeners.ts), or ` +
      `try/catch inside the loop. A throwing subscriber must not stop the others ` +
      `from being told, nor unwind into the caller that fired the event.`,
  );
  process.exit(1);
}

console.log('Listener fan-outs OK: every hand-rolled fan-out isolates its subscribers.');
