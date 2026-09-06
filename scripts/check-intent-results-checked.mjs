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

/**
 * How many unassigned `execute({` calls this run actually looked at.
 *
 * A floor, because the failure above was silent: the gate did not report
 * "nothing matched", it reported success. A pattern that stops matching -- an
 * API rename, a move to a helper, a receiver spelled differently again --
 * must be loud, not green.
 *
 * The number is a FLOOR on sites CONSIDERED, not on problems found. Zero
 * problems is the goal; zero sites examined means the gate is inert.
 *
 * TWO SHAPES, because only one was checked. `await io.execute({…})` discards the
 * result outright and is caught below. `const r = await io.execute({…})` assigns
 * it — and nothing required `r` to ever be READ, so the identical failure one
 * binding later passed. Every site in the tree currently reads its result, so
 * this is preventive rather than a live finding; it is the exact defect the gate
 * was written for, one syntax away from the form it caught.
 *
 * Comments are stripped before any of this. Three of the `.execute({`
 * occurrences in the tree are prose describing the defect, and counting them
 * inflates the very floor that is supposed to prove the API still exists.
 */
let considered = 0;

/** Any `.execute(` at all, assigned or not — the signal that the API still exists. */
let executeCallsSeen = 0;

/** Source with comments blanked, LINE COUNT PRESERVED so numbers stay true. */
function withoutComments(text) {
  let out = text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  return out
    .split('\n')
    .map((line) => line.replace(/(^|[^:])\/\/.*$/, (m, p) => p + ' '.repeat(m.length - p.length)))
    .join('\n');
}

for (const file of sourceFiles(ROOT)) {
  const lines = withoutComments(readFileSync(file, 'utf8')).split('\n');

  lines.forEach((line, i) => {
    if (/\.execute\(\{/.test(line)) executeCallsSeen += 1;
    // A member CHAIN, not a bare identifier.
    //
    // This was `\w+\.execute\(` -- which matches `io.execute(` and not
    // `deps.io.execute(`. Every call site in the tree used the second form, so
    // the gate evaluated ZERO sites and printed success on every run while four
    // `persist-pending-ops` results went unread. A retry queue whose write
    // failed was reported as queued, and the operations were gone on reload.
    const discards = /^\s*await\s+[\w.?![\]]+\.execute\(\{/.test(line);
    const assignment = line.match(/^\s*(?:const|let|var)\s+(\w+)[^=]*=\s*await\s+[\w.?![\]]+\.execute\(\{/);
    if (!discards && !assignment) return;
    considered += 1;

    // The intent type is on this line or the next.
    const window = `${line}\n${lines[i + 1] ?? ''}`;
    const match = window.match(/type:\s*'([a-z-]+)'/);
    if (!match || !REPORTS_FAILURE.has(match[1])) return;

    // An assigned result counts as checked only if the binding is READ. Twenty
    // lines is the body of a handler; beyond that a result is not being acted
    // on in response to the call.
    if (assignment) {
      const name = assignment[1];
      const after = lines.slice(i + 1, i + 21).join('\n');
      if (new RegExp(`\\b${name}\\b`).test(after)) return;
    }

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

// Every call site may legitimately be assigned, in which case `considered` is
// zero and there is genuinely nothing to check -- but so is the state where
// the pattern has rotted. Distinguish them by requiring that SOME `.execute(`
// call exists at all; if the API is gone, say so rather than pass.
if (executeCallsSeen === 0) {
  console.error(
    'FAIL: no `.execute(` call sites found anywhere. Either the intent API was\n' +
      'renamed or the scan root moved -- this gate is now inert and reporting\n' +
      'success, which is how it missed four unread results before.',
  );
  process.exit(1);
}

console.log(
  `Intent results: ${executeCallsSeen} execute() call site(s) seen, ${considered} examined; ` +
    'every failure-reporting intent is checked or explicitly best-effort.',
);
