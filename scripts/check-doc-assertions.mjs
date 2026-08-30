#!/usr/bin/env node
/**
 * Checks `verify:` annotations — the escape hatch for claims that prose makes
 * and no extractor can read.
 *
 * deploy.sh's header said "Rebuilds only changed images" long after it stopped
 * building anything. No parser can know whether that sentence is true; the
 * sentence names no command and describes behaviour. The only honest mechanism
 * is to let the author restate the claim as something checkable and pin it:
 *
 *     # verify: absent 'docker compose build' in-body deploy.sh
 *
 * That is not the sentence, but it is the fact the sentence depends on, and CI
 * can hold it forever.
 *
 * Deliberately NOT a shell runner. The vocabulary is four verbs, so every
 * failure message can be generated and the gate never executes repo code:
 *
 *   exists <path>
 *   count  <dir> <ext> <op> <n>        op: == != >= <=
 *   grep   <pattern> <file>            pattern must appear
 *   absent <pattern> in-body <file>    must NOT appear outside comment lines
 *
 * An annotation that fails to PARSE is an error, never a skip. A decaying
 * annotation must not quietly become a no-op — that is the failure this whole
 * family of gates exists to prevent.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCAN = ['README.md', 'ARCHITECTURE.md', 'deploy.sh', 'docker-compose.production.yml',
  ...readdirSync(join(ROOT, 'docs')).filter((f) => f.endsWith('.md')).map((f) => join('docs', f))];

const failures = [];
let checked = 0;

/** Lines that are not comments, for `absent ... in-body`. */
const bodyOf = (text) => text.split('\n')
  .filter((l) => !/^\s*(#|\/\/|\*|<!--)/.test(l))
  .join('\n');

function run(verb, args, where) {
  if (verb === 'exists') {
    const [p] = args;
    if (!existsSync(join(ROOT, p))) return `${p} does not exist.`;
    return null;
  }
  if (verb === 'count') {
    const [dir, ext, op, nRaw] = args;
    const n = Number(nRaw);
    if (!existsSync(join(ROOT, dir))) return `directory ${dir} does not exist.`;
    const actual = readdirSync(join(ROOT, dir)).filter((f) => f.endsWith(ext)).length;
    const ok = { '==': actual === n, '!=': actual !== n, '>=': actual >= n, '<=': actual <= n }[op];
    if (ok === undefined) return `unknown operator "${op}".`;
    if (!ok) return `${dir} holds ${actual} ${ext} file(s); the doc says ${op} ${n}.\n    Either the doc's number is stale, or something was added or removed that the doc should mention.`;
    return null;
  }
  const file = args[args.length - 1];
  if (!existsSync(join(ROOT, file))) return `${file} does not exist.`;
  const text = readFileSync(join(ROOT, file), 'utf8');
  const pattern = args.slice(0, verb === 'absent' ? -2 : -1).join(' ');
  if (verb === 'grep') {
    if (!text.includes(pattern)) return `"${pattern}" no longer appears in ${file}.`;
    return null;
  }
  if (verb === 'absent') {
    if (bodyOf(text).includes(pattern)) {
      return `"${pattern}" appears in ${file}'s body.\n    The doc states this does not happen. Either it happens again — in which case the doc is now wrong — or the annotation should go.`;
    }
    return null;
  }
  return `unknown verb "${verb}".`;
}

for (const rel of SCAN) {
  const full = join(ROOT, rel);
  if (!existsSync(full)) continue;
  readFileSync(full, 'utf8').split('\n').forEach((line, idx) => {
    const m = line.match(/verify:\s*(.+?)\s*(?:-->)?\s*$/);
    if (!m) return;
    const where = `${rel}:${idx + 1}`;
    // Quoted patterns hold together; everything else splits on whitespace.
    const parts = m[1].match(/'[^']*'|\S+/g)?.map((t) => t.replace(/^'|'$/g, '')) ?? [];
    const [verb, ...args] = parts;
    if (!['exists', 'count', 'grep', 'absent'].includes(verb) || args.length === 0) {
      failures.push(`${where}\n    cannot parse: verify: ${m[1]}\n    Vocabulary is exists|count|grep|absent. An annotation that does not parse is an error, not a skip: a decaying pin must never become a silent no-op.`);
      return;
    }
    checked++;
    const problem = run(verb, args, where);
    if (problem) failures.push(`${where}\n    verify: ${m[1]}\n    ${problem}`);
  });
}

// Anti-vacuity: annotations are the only pin on prose, so a run that finds none
// is not a clean run — it means they were deleted or the parser stopped matching.
if (checked < 2) {
  failures.push(`Only ${checked} verify: annotation(s) found; expected at least 2. Either they were removed, or this parser no longer recognises them — in which case the prose they pinned is unguarded again and nothing would say so.`);
}

if (failures.length) {
  console.error(`\nDoc assertions: ${failures.length} problem(s)\n`);
  for (const f of failures) console.error(`  - ${f}\n`);
  process.exit(1);
}
console.log(`Doc assertions: ${checked} verify: annotation(s) hold.`);
