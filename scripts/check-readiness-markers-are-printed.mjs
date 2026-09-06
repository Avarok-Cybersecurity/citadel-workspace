#!/usr/bin/env node
/**
 * A "wait until you see this line" marker must be a line something prints.
 *
 * The sync-executor agent — which CLAUDE.md calls MANDATORY before any UI
 * testing — waited for
 *
 *     Running `target/debug/citadel-workspace-server-kernel --config ...`
 *
 * That is cargo's run banner. Both containers exec the RELEASE binary from
 * `/usr/local/bin` (the `CMD` in each Dockerfile); there is no `cargo run`, so
 * the string has never appeared in either image's output. Two of the agent's
 * four steps could therefore only ever time out — five minutes each — and it
 * reported a failed rebuild for a healthy one. Every backend change was routed
 * through it.
 *
 * That is the shape this gate exists for: an instruction that waits for
 * something, naming a string nothing emits. It fails silently and expensively,
 * because a timeout looks like a slow build rather than a wrong marker.
 *
 * The check is a substring search across the sources that could print it: Rust
 * log and print macros, TypeScript console calls, shell `echo`, and Dockerfile
 * CMD/ENTRYPOINT lines. Deliberately generous — the question is "could anything
 * ever emit this?", and a marker no file contains at all cannot.
 *
 * Only markers in a POLLING instruction are checked, and only ones long enough
 * to be distinctive. "Finished" or "ready in" would match half the tree and
 * prove nothing either way.
 *
 * A marker emitted by a DEPENDENCY rather than by this tree must say so, with
 * `<!-- emitted-by: <crate> -->` on the same line, and the crate must appear in
 * Cargo.lock. `Citadel client established` is one: it comes from
 * `citadel_proto`, so no amount of searching this repository would find it, and
 * the first version of this gate reported that valid marker as missing. The
 * annotation keeps the teeth -- an unprintable marker still cannot pass without
 * naming a real dependency that does not print it either, which is a lie
 * somebody has to write on purpose.
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
const ROOT = join(dirname(SELF), '..');

/** Dependency names, for markers a dependency emits rather than this tree. */
const cargoLock = existsSync(join(ROOT, 'Cargo.lock'))
  ? readFileSync(join(ROOT, 'Cargo.lock'), 'utf8')
  : '';

/** Files that tell an agent to wait for a line. */
const INSTRUCTIONS = ['.claude/agents'];

/** Where a printable string could come from. */
const HAYSTACK_DIRS = [
  'citadel-workspace-server-kernel/src',
  'citadel-workspace-internal-service/src',
  'citadel-internal-service/citadel-internal-service/src',
  'citadel-workspaces/src',
  'docker',
  'scripts',
];

const CODE = /\.(rs|ts|tsx|mjs|js|sh|yml|yaml)$/;

function* walk(dir, depth = 0) {
  if (depth > 8 || !existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'target' || entry === '.git') continue;
    const full = join(dir, entry);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) yield* walk(full, depth + 1);
    // Never read THIS file. Its header quotes marker strings as examples, and
    // `scripts/` is in its own haystack -- so it found "Citadel client
    // established" in its own comment and passed a marker nothing prints. A
    // gate matched by its own explanation is the exact defect this repository
    // keeps finding; it is easier to write than to notice.
    else if (full === SELF) continue;
    else if (CODE.test(entry) || /Dockerfile/.test(entry)) yield full;
  }
}

let haystack = '';
for (const dir of HAYSTACK_DIRS) {
  for (const file of walk(join(ROOT, dir))) {
    try { haystack += readFileSync(file, 'utf8'); } catch { /* unreadable */ }
  }
}

// Nothing to search means every marker "fails", which is not a verdict.
if (haystack.length < 100_000) {
  console.error(
    `check-readiness-markers-are-printed: only ${haystack.length} bytes of source found; ` +
      'the layout moved and every marker would be reported as missing.',
  );
  process.exit(1);
}

const problems = [];
let checked = 0;

for (const dir of INSTRUCTIONS) {
  const path = join(ROOT, dir);
  if (!existsSync(path)) continue;
  for (const name of readdirSync(path)) {
    if (!name.endsWith('.md')) continue;
    const lines = readFileSync(join(path, name), 'utf8').split('\n');
    lines.forEach((line, i) => {
      // A SUCCESS marker: a backticked string on a line that declares one.
      if (!/\*\*SUCCESS/.test(line)) return;
      for (const m of line.matchAll(/`([^`]{16,})`/g)) {
        const marker = m[1]
          .replace(/^["']|["']$/g, '')
          .replace(/\\`/g, '`')
          .trim();
        // Too generic to mean anything either way.
        if (marker.length < 16) continue;
        // A marker with a shell/format placeholder is a template, not a literal.
        if (/[${}]/.test(marker)) continue;
        checked += 1;

        // Emitted by a dependency, not by this tree. Verify the CRATE is real
        // rather than the string, which is the most this repository can know:
        // `Citadel client established` comes from `citadel_proto`, so no amount
        // of searching here would find it, and the first version of this gate
        // reported that valid marker as missing.
        const attributed = line.match(/<!--\s*emitted-by:\s*([A-Za-z0-9_-]+)\s*-->/);
        if (attributed) {
          // Cargo.lock carries the crate's real name, and crates.io permits
          // both spellings -- `citadel_proto` and `citadel-internal-service`
          // are both literal entries here. Normalising one way was wrong and
          // rejected a valid attribution; accept either spelling.
          const named = attributed[1];
          const found = [named, named.replace(/_/g, '-'), named.replace(/-/g, '_')].some((c) =>
            new RegExp(`^name = "${c}"$`, 'm').test(cargoLock),
          );
          if (!found) {
            problems.push({
              file: `${dir}/${name}`,
              line: i + 1,
              marker: `${marker} — attributed to "${attributed[1]}", which is not a dependency`,
            });
          }
          continue;
        }

        // Search for the most distinctive run of the marker: its first clause.
        // A full match would fail on any interpolation the code does.
        const probe = marker.split(/[`'"]/)[0].trim();
        if (probe.length >= 16 && !haystack.includes(probe)) {
          problems.push({ file: `${dir}/${name}`, line: i + 1, marker: probe });
        }
      }
    });
  }
}

if (checked === 0) {
  console.error(
    'check-readiness-markers-are-printed: no **SUCCESS** marker found in any agent ' +
      'definition, so nothing was checked. The instruction format changed.',
  );
  process.exit(1);
}

if (problems.length > 0) {
  console.error('Agents wait for lines that nothing in the tree prints:\n');
  for (const p of problems) {
    console.error(`  ${p.file}:${p.line} — waits for "${p.marker}"`);
  }
  console.error(
    '\n  A marker nothing emits cannot be waited for: the step times out and reports\n' +
      '  a failure for healthy work. Name a string the service actually logs — check\n' +
      "  the crate's main.rs, or the container's CMD.\n",
  );
  process.exit(1);
}

console.log(
  `check-readiness-markers-are-printed: all ${checked} readiness marker(s) appear in the tree.`,
);
