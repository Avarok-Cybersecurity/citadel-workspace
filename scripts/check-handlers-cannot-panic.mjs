#!/usr/bin/env node
/**
 * A panic in a request handler is a request that hangs for ever.
 *
 * Handlers run in per-request spawned tasks. When one panics the task dies, **no
 * response is written**, and the browser waits out its own timeout with nothing
 * to show — indistinguishable from a network stall, and invisible in the service
 * logs beyond the panic itself.
 *
 * This is not hypothetical. `generate_remote` carried
 * `.expect("Should not fail to find target")` on a call that returns `Err` for
 * any CID the node does not know locally. All five LocalDB handlers routed
 * through it, and `LocalDBGetKV` is exempt from the ownership gate — so the
 * first stale read after an internal-service restart (which drops all accounts,
 * while browsers keep their CIDs) hung silently.
 *
 * `#[cfg(test)]` modules are excluded: a panic in a test is a failing test,
 * which is the point of one.
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIRS = [
  'citadel-internal-service/citadel-internal-service/src/kernel/requests',
  'citadel-internal-service/citadel-internal-service/src/kernel/responses',
];

/**
 * Panics that are genuinely unreachable, each with the argument for why. An
 * entry here is a claim someone has to defend, not a way to quiet the check.
 */
//
// Keyed by file AND the exact source text, not by file alone. A per-file
// exemption excuses every future panic added to that file, which is the
// opposite of what an argued exception means: the argument was about ONE line.
const ALLOWED = new Map([
  [
    'requests/media/open.rs::let session = peer.media.take().expect("checked Some above");',
    'the check and the take share one write lock with no await between them',
  ],
]);

if (!DIRS.every((d) => existsSync(join(ROOT, d)))) {
  console.error('check-handlers-cannot-panic: the handler directories are missing, so nothing was checked.');
  process.exit(1);
}

/** Remove `#[cfg(test)] mod … { … }` blocks, brace-matched. */
function stripTests(source) {
  let out = source;
  for (;;) {
    const m = /#\[cfg\(test\)\]\s*mod\s+\w+\s*\{/.exec(out);
    if (!m) return out;
    let depth = 0;
    let end = out.length;
    for (let i = m.index + m[0].length - 1; i < out.length; i += 1) {
      if (out[i] === '{') depth += 1;
      else if (out[i] === '}') {
        depth -= 1;
        if (depth === 0) { end = i + 1; break; }
      }
    }
    out = out.slice(0, m.index) + out.slice(end);
  }
}

function* walk(dir) {
  for (const entry of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${entry}`;
    if (statSync(join(ROOT, rel)).isDirectory()) yield* walk(rel);
    else if (entry.endsWith('.rs')) yield rel;
  }
}

const offenders = [];
let scanned = 0;

for (const dir of DIRS) {
  for (const file of walk(dir)) {
    const rel = relative(join(ROOT, 'citadel-internal-service/citadel-internal-service/src/kernel'), join(ROOT, file));
    const source = stripTests(readFileSync(join(ROOT, file), 'utf8'));
    scanned += 1;

    source.split('\n').forEach((line, i) => {
      // `unreachable!` on an already-destructured request variant is a
      // type-level impossibility, not a runtime path.
      if (line.includes('unreachable!')) return;
      // Doc comments describing a panic that was REMOVED are prose.
      if (line.trim().startsWith('//')) return;
      // A check named "handlers cannot panic" that only knows two spellings is
      // not checking what it claims. `panic!`, `todo!` and `unimplemented!` all
      // abort a request handler exactly as hard as an `unwrap`.
      if (!/\.expect\(|\.unwrap\(\)|\bpanic!|\btodo!|\bunimplemented!/.test(line)) return;
      if (ALLOWED.has(`${rel}::${line.trim()}`)) return;
      offenders.push({ rel, line: i + 1, text: line.trim().slice(0, 100) });
    });
  }
}

if (offenders.length > 0) {
  for (const { rel, line, text } of offenders) {
    console.error(`::error::${rel}:${line} can panic — ${text}`);
  }
  console.error(`\nFAIL: ${offenders.length} panic site(s) in request handlers.`);
  console.error('A panicking handler never answers, so the client hangs until its own timeout.');
  console.error('Return the matching *Failure response instead, or justify it in ALLOWED.');
  process.exit(1);
}

console.log(`No panic sites in ${scanned} handler files (${ALLOWED.size} justified).`);
