/**
 * Work whose only consumer is a log line must be behind `log_enabled!`.
 *
 * The UI learned this and has a gate for it: `debugLog` is a noop in
 * production, but JavaScript evaluates its ARGUMENTS regardless, so
 * `debugLog('x', fnv1a64(bytes))` hashed every byte of every inbound message
 * and handed the result to a function that discarded it.
 *
 * `log::info!` has exactly the same property, and the fix never crossed the
 * language boundary. Two sites in the connector, found by inspection rather
 * than by any gate:
 *
 *   - `messenger/mod.rs` computed an FNV-1a fingerprint over the WHOLE message
 *     payload -- three operations per byte -- before the `log::info!` that was
 *     its only consumer. A 1 MiB document update paid 1,048,576 iterations per
 *     delivery, on the delivery path, in every deployment where the `ism`
 *     target is filtered out, which is all of them but the test run it was
 *     written for.
 *
 *   - the same file collected the ENTIRE routing DashMap into a `Vec` on every
 *     routed inbound message, to interpolate into one `log::info!`. It was also
 *     read by a `log::warn!` on a rare branch, which is why one binding served
 *     both and the rare branch's cost became the common branch's.
 *
 * THE RULE. A `let` binding whose initialiser does real work -- a `.collect()`,
 * or a `for` loop accumulating into it -- and whose value is used ONLY inside
 * log-macro arguments, must sit inside an `if log_enabled!(...)` block.
 *
 * A value used anywhere else is not flagged: it is not log-only work, and
 * guarding it would change behaviour rather than cost.
 *
 * WHAT THIS CANNOT SEE. Work passed inline as a macro argument
 * (`log::info!("{}", expensive())`) is invisible to it, because `log_enabled!`
 * cannot help there either -- the macro's own level check already short-circuits
 * an inline argument. This gate is about work hoisted into a `let` ABOVE the
 * macro, which is the shape that defeats that check and the shape that bit us.
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
/**
 * Every Rust tree that logs, not just the one the defect was found in.
 *
 * The first version listed the agent's two crates and nothing else. The
 * workspace SERVER KERNEL has 125 logging sites and was not read at all --
 * a gate reporting "none is log-only work done unconditionally" over roughly a
 * third of the population it names.
 */
const TREES = [
  join(ROOT, 'citadel-internal-service', 'citadel-internal-service-connector', 'src'),
  join(ROOT, 'citadel-internal-service', 'citadel-internal-service', 'src'),
  join(ROOT, 'citadel-workspace-server-kernel', 'src'),
  join(ROOT, 'citadel-workspace-internal-service', 'src'),
  join(ROOT, 'citadel-workspace-types', 'src'),
];

const present = TREES.filter((t) => existsSync(t));
if (present.length === 0) {
  console.error(
    'FAIL: none of the agent source trees are present, so this gate examined nothing.\n' +
      'Run `git submodule update --init --recursive` first.',
  );
  process.exit(1);
}

function* rustFiles(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) { yield* rustFiles(full); continue; }
    if (entry.endsWith('.rs')) yield full;
  }
}

/** A binding filled by `.collect()`. */
const COLLECTS = /^\s*let\s+(?:mut\s+)?(\w+)\s*(?::[^=]+)?=\s*[\s\S]*?\.collect\s*\(\s*\)\s*;/;

/**
 * A `let mut` seed, which a following `for` loop fills.
 *
 * This is the shape of the costlier of the two real defects -- an FNV-1a
 * fingerprint accumulated over every byte of the message payload -- and the
 * first version of this gate could not see it: the `.collect()` rule does not
 * match, and the placeholder branch for accumulators was written
 * `ACCUMULATOR.exec(line) ? null : null`, which is `null` either way. A branch
 * that cannot contribute is the same defect this repository keeps finding in
 * its tests, in the gate meant to catch it.
 */
const ACCUMULATOR = /^\s*let\s+mut\s+(\w+)\s*(?::[^=]+)?=\s*[^;]+;\s*$/;

/** A `for` loop, whose body is the rest of the accumulator's construction. */
const FOR_LOOP = /^\s*for\s+.*\{\s*$/;

/**
 * The start of a log-macro statement, PATH-QUALIFIED OR NOT.
 *
 * The first version required a `log::` or `tracing::` prefix. The server kernel
 * imports the macros and writes `info!(target: "citadel", …)` — 125 sites, none
 * of which this could see even once its tree was added. Two blind spots, and
 * either alone was enough to keep the gate green over the whole crate.
 *
 * The `[^\w:]` prefix keeps `some_helper_info!` from matching, and the optional
 * path segment keeps `::log::info!` matching.
 */
const LOG_MACRO_START =
  /(?:^|[^\w:])(?:(?:::)?(?:log|tracing)::)?(?:trace|debug|info|warn|error)\s*!/;

/**
 * The guard that makes the work conditional — in EITHER facade.
 *
 * This tree runs two. The connector logs through `log`, whose guard is
 * `log_enabled!`; everything reaching `citadel_sdk::logging` logs through
 * `tracing` (`citadel_logging` re-exports it), whose guard is `enabled!`.
 * Recognising only the first would have reported a correctly guarded tracing
 * site as unguarded the moment anyone wrote one — which is what happened on the
 * first fix attempted after this gate's coverage was widened.
 */
const GUARD = /(?:log_enabled|enabled)\s*!/;

/**
 * Which byte offsets of `source` sit inside a string literal or a comment.
 *
 * Load-bearing, and the reason this gate exists in its current form. The first
 * version walked back to the nearest `;`, `{` or `}` to find the start of the
 * enclosing statement -- and every Rust format string is full of `{}`
 * placeholders. Walking back from a use inside
 * `log::info!("source={} dest={} …", …, available_keys)` stopped at the `}` of
 * the LAST placeholder, so the slice never contained `log::info!`, the use was
 * judged not-in-a-log, and the gate reported green over the exact defect it was
 * written for.
 *
 * It was only caught by running it against the tree that still had the defect.
 * A gate is not finished when it passes; it is finished when it has failed on
 * the thing it is for.
 */
function maskLiterals(source) {
  const inLiteral = new Uint8Array(source.length);
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    if (c === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') { inLiteral[i] = 1; i += 1; }
      continue;
    }
    if (c === '/' && source[i + 1] === '*') {
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) { inLiteral[i] = 1; i += 1; }
      inLiteral[i] = 1; inLiteral[i + 1] = 1; i += 2;
      continue;
    }
    if (c === '"') {
      inLiteral[i] = 1; i += 1;
      while (i < source.length && source[i] !== '"') {
        if (source[i] === '\\') { inLiteral[i] = 1; i += 1; }
        if (i < source.length) { inLiteral[i] = 1; i += 1; }
      }
      inLiteral[i] = 1; i += 1;
      continue;
    }
    i += 1;
  }
  return inLiteral;
}

/**
 * The byte ranges covered by log-macro invocations.
 *
 * Computed by matching parentheses from each macro's `(` to its close, skipping
 * anything the literal mask marks, rather than by guessing where the enclosing
 * statement began.
 *
 * The guessing version failed twice, and both failures were false GREENS on a
 * real defect:
 *
 *   1. It walked back to the nearest `{`, and every Rust format string is full
 *      of `{}` placeholders.
 *   2. Masking string literals fixed that, and it still missed the site, because
 *      the macro's arguments contained a real `match … { … }`. Braces inside
 *      macro arguments are not a statement boundary either.
 *
 * Both were caught only by running the gate against the tree that still had the
 * defect. A gate is not finished when it passes.
 */
function logMacroSpans(source, mask) {
  const spans = [];
  const re = new RegExp(LOG_MACRO_START.source, 'g');
  let m;
  while ((m = re.exec(source)) !== null) {
    if (mask[m.index]) continue;
    let i = m.index + m[0].length;
    while (i < source.length && source[i] !== '(') i += 1;
    if (i >= source.length) continue;
    let depth = 0;
    const open = i;
    for (; i < source.length; i += 1) {
      if (mask[i]) continue;
      if (source[i] === '(') depth += 1;
      else if (source[i] === ')') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    spans.push([open, i]);
  }
  return spans;
}

/** Is the occurrence at `idx` inside one of those spans? */
function insideLogMacro(spans, idx) {
  return spans.some(([a, b]) => idx > a && idx < b);
}

/**
 * Is the binding at `lineNo` already inside a guard block?
 *
 * COMMENTS ARE SKIPPED, and that is not a detail. Every one of these guards
 * carries a comment above it explaining why the work is conditional — and those
 * comments contain the words `log_enabled!` and `enabled!`. Without this filter
 * the gate reads its own explanation as the guard, so DELETING the guard leaves
 * it green: caught by a negative control, on the very site the gate had just
 * been widened to find.
 *
 * The same mistake, in a different gate, is already in this record —
 * `check-wasm-rebuild-triggers-match-the-stamp` was satisfied by the comment
 * explaining its rule. Twice now.
 */
function guarded(lines, lineNo) {
  // Bounded look-back: the guard is the enclosing `if`, so it is within a few
  // lines. 25 covers the commented cases here.
  for (let i = lineNo; i >= Math.max(0, lineNo - 25); i -= 1) {
    const line = lines[i];
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue; // a comment guards nothing
    if (GUARD.test(line)) return true;
  }
  return false;
}

const problems = [];
let filesRead = 0;
let bindingsExamined = 0;
let logMacrosSeen = 0;

for (const dir of present) {
  for (const file of rustFiles(dir)) {
    filesRead += 1;
    const source = readFileSync(file, 'utf8');
    const mask = maskLiterals(source);
    const spans = logMacroSpans(source, mask);
    const rel = relative(ROOT, file);
    const lines = source.split('\n');

    logMacrosSeen += (source.match(new RegExp(LOG_MACRO_START, 'g')) ?? []).length;

    // Tests may log freely; they are not a hot path and their cost is bounded.
    const testAt = lines.findIndex((l) => /^\s*#\[cfg\(test\)\]/.test(l));
    const limit = testAt === -1 ? lines.length : testAt;

    for (let i = 0; i < limit; i += 1) {
      const line = lines[i];
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;

      // A `.collect()` may span lines; join a small window to catch it.
      const window = lines.slice(i, Math.min(i + 4, limit)).join('\n');
      const collected = COLLECTS.exec(window);

      // An accumulator counts only if a `for` loop actually follows it. A bare
      // `let mut x = 0;` is not construction work.
      let accumulated = null;
      let loopEnd = -1;
      if (!collected) {
        const acc = ACCUMULATOR.exec(line);
        if (acc) {
          for (let j = i + 1; j < Math.min(i + 4, limit); j += 1) {
            if (!FOR_LOOP.test(lines[j])) continue;
            accumulated = acc;
            // The loop body is construction, not consumption: find its close by
            // matching braces from the `for` line.
            let depth = 0;
            for (let k = j; k < limit; k += 1) {
              for (const ch of lines[k]) {
                if (ch === '{') depth += 1;
                else if (ch === '}') depth -= 1;
              }
              if (depth === 0) { loopEnd = k; break; }
            }
            break;
          }
        }
      }

      const m = collected ?? accumulated;
      if (!m) continue;

      const name = m[1];
      bindingsExamined += 1;

      // Every OTHER mention of this name in the file.
      const uses = [];
      const re = new RegExp(`\\b${name}\\b`, 'g');
      let hit;
      while ((hit = re.exec(source)) !== null) {
        if (!mask[hit.index]) uses.push(hit.index); // not a mention in a comment
      }

      // Position of the declaration itself, to exclude it.
      const declIdx = source.indexOf(line);
      let constructionEnd = declIdx + line.length;
      if (loopEnd !== -1) {
        // Everything through the accumulating loop is construction.
        constructionEnd = lines.slice(0, loopEnd + 1).join('\n').length;
      }
      const others = uses.filter((u) => u < declIdx || u > constructionEnd);
      if (others.length === 0) continue; // unused; a different gate's problem

      const allInLogs = others.every((u) => insideLogMacro(spans, u));
      if (!allInLogs) continue;
      if (guarded(lines, i)) continue;

      problems.push(
        `${rel}:${i + 1}: \`${name}\` is built by real work and read ONLY by log macros, ` +
          'outside any `log_enabled!` guard',
      );
    }
  }
}

// Vacuity floor. These trees are full of log macros; finding none means the
// walk or the pattern moved, and a clean bill over that is the failure this
// gate is about.
if (filesRead < 20 || logMacrosSeen < 150) {
  console.error(
    `FAIL: read ${filesRead} file(s) and ${logMacrosSeen} log macro(s) — far too few.\n` +
      'The walk or the pattern moved, so this gate examined essentially nothing.',
  );
  process.exit(1);
}

if (problems.length > 0) {
  for (const p of problems) console.error(`::error::${p}`);
  console.error(`\nFAIL: ${problems.length} log-only computation(s) done unconditionally.\n`);
  for (const p of problems) console.error(`  ${p}`);
  console.error(
    '\nWrap the binding:\n' +
      '    if log::log_enabled!(target: "…", log::Level::Info) { … }\n' +
      '\n`log::info!` checks the level, but a `let` ABOVE it does not. The last two of these\n' +
      'hashed every byte of every delivered message, and walked the whole routing table per\n' +
      'routed message, for lines the default filter drops.\n' +
      '\nThe UI already has this gate (check-debug-args-are-cheap.mjs). This is the same rule,\n' +
      'in the language the fix was never carried to.',
  );
  process.exit(1);
}

console.log(
  `check-log-arguments-are-cheap-in-rust: ${filesRead} file(s), ${logMacrosSeen} log macro(s), ` +
    `${bindingsExamined} working binding(s); none is log-only work done unconditionally.`,
);
