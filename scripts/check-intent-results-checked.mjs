#!/usr/bin/env node
/**
 * An intent whose result reports failure must have that result read.
 *
 * `RevfsIO.execute` never rejects. Every failure — a network timeout, a rejected
 * request, a full disk — comes back as `{ success: false }` on a resolved
 * promise. So `await io.execute({...})` with the result discarded is not
 * "fire and forget": it is "ask whether this worked, then look away".
 *
 * That single shape produced three separate user-visible data-loss bugs in this
 * layer, each with a green toast on the other side of it:
 *
 *   - upload  resolved false, the caller discarded it, the UI said "Uploaded".
 *   - delete  resolved false, the caller discarded it, and the tree node had
 *             already been removed — so the bytes were orphaned.
 *   - download resolved false, the caller checked only `result.type`, returned
 *             `undefined`, and the UI said "Download initiated".
 *
 * This flags the remaining ones rather than waiting for the next audit to find
 * them by hand.
 *
 * Deliberate best-effort calls are allowed, but must SAY so: put
 * `// best-effort:` with a reason on the line above. That turns an invisible
 * omission into a visible decision.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolved from this file, not from the caller's cwd — a guard that only works
// when invoked from one directory gets invoked from another and silently
// crashes, which reads the same as it being unavailable.
const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = join(REPO, 'citadel-workspaces/src/lib/revfs');

/** Intent types whose result carries a `success` field worth reading. */
const REPORTS_FAILURE = new Set([
  'send-revfs-op',
  'persist-tree',
  'persist-pending-ops',
  'backend-send-file',
  'backend-download-file',
  'backend-delete-file',
]);

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return e.name === '__tests__' ? [] : sourceFiles(path);
    return e.isFile() && e.name.endsWith('.ts') ? [path] : [];
  });
}

const problems = [];

for (const file of sourceFiles(ROOT)) {
  const lines = readFileSync(file, 'utf8').split('\n');

  lines.forEach((line, i) => {
    // Only unassigned awaits: `await io.execute({` with nothing binding it.
    if (!/^\s*await\s+\w+\.execute\(\{/.test(line)) return;

    // The intent type is on this line or the next.
    const window = `${line}\n${lines[i + 1] ?? ''}`;
    const match = window.match(/type:\s*'([a-z-]+)'/);
    if (!match || !REPORTS_FAILURE.has(match[1])) return;

    // An explicit, reasoned opt-out on the preceding line.
    const preceding = lines.slice(Math.max(0, i - 3), i).join('\n');
    if (/best-effort:/.test(preceding)) return;

    problems.push({
      file: relative(REPO, file),
      line: i + 1,
      intent: match[1],
    });
  });
}

if (problems.length > 0) {
  console.error(`Intent results discarded: ${problems.length}\n`);
  for (const p of problems) {
    console.error(`  ${p.file}:${p.line} — '${p.intent}' can resolve { success: false }, and the result is discarded.`);
  }
  console.error(
    '\nEither read the result and act on a failure, or mark the call\n' +
      '  // best-effort: <why a failure here is acceptable>\n' +
      'on the line above. execute() never rejects, so an unread result means a\n' +
      'failure is invisible to the user.'
  );
  process.exit(1);
}

console.log('Intent results: every failure-reporting intent is checked or explicitly best-effort.');
