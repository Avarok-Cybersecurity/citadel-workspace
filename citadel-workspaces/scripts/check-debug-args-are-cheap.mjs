/**
 * A log line that costs nothing to print must cost nothing to build.
 *
 * `debugLog` is `noop` when `import.meta.env.DEV` is false, but JavaScript
 * evaluates its ARGUMENTS at the call site regardless. So
 * `debugLog('x', fnv1a64(bytes))` hashed every byte of every inbound P2P
 * message in production and handed the result to a function that discards it.
 * `fnv1a64` is a BigInt loop -- three BigInt operations per byte -- and the
 * inline transfer cap is 16 MiB, so one large file cost close to a second of
 * main-thread time at a single call site, for no output.
 *
 * The same shape appeared four more times: a per-forward payload fingerprint,
 * two whole-object `JSON.stringify`s (one of them on a 30-second poll), and a
 * settings dump.
 *
 * The fix is a call-site guard, not a thunk API: `if (debugEnabled) debugLog(…)`
 * is a constant condition in the production bundle, so Rollup removes the
 * branch entirely. The ~1100 call sites that pass strings need no guard and do
 * not get one -- this only constrains arguments that do real work.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');

/**
 * Calls that are too expensive to make for a logger that may discard them.
 *
 * A denylist rather than a general "any call expression" rule: plenty of cheap
 * accessors appear in log arguments and forbidding all of them would be noise
 * nobody could act on.
 *
 * The cost of a denylist is that it is only as complete as its last edit, and
 * it under-reported for exactly that reason. `formatForDebug` was missing:
 * given a string it runs `JSON.parse` and then rebuilds the whole object
 * recursively, and it sat unguarded inside a `debugLog` on the session-store
 * write path -- so every auth, auto-reconnect, logout, role update and
 * active-index change re-parsed and rebuilt the entire stored-session list in
 * production and threw the result away. The gate read green over it.
 *
 * When adding an entry here, add it because the function does WORK, not
 * because it looks costly: the bar is a loop, a parse, or a full traversal.
 */
const EXPENSIVE = /\b(fnv1a64|sha256Sync|describeForwarded|formatForDebug|JSON\.stringify)\s*\(/;

/** Log functions that are compiled away, so their arguments are wasted work. */
const NOOP_IN_PROD = /\b(debugLog|warnLog)\s*\(/;

/**
 * The line where the top-level declaration containing `index` begins.
 *
 * Column-zero heuristic: `export function`, `function`, `const x = (` and
 * class members at two spaces all start a region a guard could live in. It is
 * a bound on how far back to look, not a parser -- a guard further up than
 * its own function cannot apply to this call anyway.
 */
function enclosingStart(lines, index) {
  for (let i = index; i >= 0; i -= 1) {
    if (/^(export\s+)?(async\s+)?(function|class|const|let)\b/.test(lines[i])) return i;
  }
  return 0;
}

/**
 * The text of the call beginning on `lines[start]`, to its closing paren.
 *
 * Bounded at 20 lines: an argument list longer than that is not a log call,
 * and an unbalanced paren (a string containing one, a comment) must not make
 * this run to the end of the file.
 */
function callText(lines, start) {
  let depth = 0;
  let seen = false;
  const parts = [];
  for (let i = start; i < lines.length && i < start + 20; i += 1) {
    parts.push(lines[i]);
    for (const ch of lines[i]) {
      if (ch === '(') { depth += 1; seen = true; }
      else if (ch === ')') depth -= 1;
    }
    if (seen && depth <= 0) break;
  }
  return parts.join('\n');
}

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (entry === '__tests__' || entry === 'node_modules') continue;
    const st = statSync(full);
    if (st.isDirectory()) yield* walk(full);
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) yield full;
  }
}

const problems = [];
let logCalls = 0;
let guarded = 0;

for (const file of walk(SRC)) {
  // Comments blanked, not removed, so reported line numbers stay true.
  //
  // The first run of this gate flagged its own explanation: `debug-config.ts`
  // documents the hazard with a literal `debugLog('x', fnv1a64(bytes))`, and a
  // raw-text scan cannot tell an example from a call. That is the same defect
  // this repository has now found four times -- a check satisfied by prose --
  // and writing it again while building a gate against a different defect is
  // the reason the rule is worth stating: a gate must read CODE.
  const lines = readFileSync(file, 'utf8')
    .split('\n')
    .map((line) => (/^\s*(\/\/|\*|\/\*)/.test(line) ? '' : line));

  lines.forEach((line, i) => {
    if (!NOOP_IN_PROD.test(line)) return;
    logCalls += 1;

    // The whole CALL, not one line of it.
    //
    // The first version tested `debugLog(` and the expensive argument on the
    // SAME line, so a call written across several lines escaped entirely --
    // and router-diagnostics.ts is exactly that shape: `debugLog(` on one
    // line, `describeForwarded(message)` two lines below, running once per
    // inbound message in every tab. The gate reported "all of them guarded"
    // while the largest remaining instance sat outside its view.
    //
    // Read forward to the call's closing paren by depth, so the window is the
    // argument list rather than a guessed number of lines.
    const call = callText(lines, i);
    if (!EXPENSIVE.test(call)) return;

    // Two guard shapes, both legitimate:
    //
    //   if (debugEnabled) { debugLog(...) }   — wraps the call
    //   if (!debugEnabled) return;            — guards the whole function
    //
    // The second is often the better code when a function does nothing but
    // log, and the first version of this gate could not see it: it looked
    // three lines up for a wrapping `if`, so an early return at the top of
    // the function read as unguarded. Search back to the start of the
    // enclosing top-level declaration instead of a fixed number of lines.
    const functionStart = enclosingStart(lines, i);
    const window = lines.slice(functionStart, i + 1).join('\n');
    const wrapped = /\bif\s*\(\s*debugEnabled\s*\)/.test(window);
    const earlyReturn = /\bif\s*\(\s*!\s*debugEnabled\s*\)\s*return\b/.test(window);
    if (wrapped || earlyReturn) { guarded += 1; return; }

    problems.push(`${relative(ROOT, file)}:${i + 1}  ${line.trim().slice(0, 90)}`);
  });
}

if (logCalls === 0) {
  console.error('FAIL: no debugLog/warnLog call sites found — this gate is inert and would pass by considering nothing.');
  process.exit(1);
}

if (problems.length > 0) {
  for (const p of problems) console.error(`::error file=${p.split(':')[0]}::${p}`);
  console.error(`\nFAIL: ${problems.length} log call(s) build an expensive argument that production throws away.\n`);
  for (const p of problems) console.error(`  ${p}`);
  console.error(
    '\nWrap the call site:\n' +
      '    if (debugEnabled) debugLog(...);\n\n' +
      'debugLog is a noop in production, but its ARGUMENTS are still evaluated.\n' +
      'Rollup removes an `if (debugEnabled)` branch from the production bundle,\n' +
      'so the guard costs nothing.',
  );
  process.exit(1);
}

console.log(
  `check-debug-args-are-cheap: ${logCalls} log call site(s) scanned, ${guarded} carrying ` +
    'expensive arguments and all of them guarded.',
);
