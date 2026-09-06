/**
 * Nothing may check submodules out with `--remote`.
 *
 * `git submodule update --remote` deliberately IGNORES the commit the superproject
 * records and takes each submodule's configured branch tip instead — the branch
 * named in `.gitmodules`, or the remote's default branch when none is named.
 *
 * That is the opposite of what a deployment wants. `update-avarok-server.sh` ran
 * it on the live server, one line after `git pull`, so the tree that got built was
 * the parent commit's own files plus whatever `master` happened to point at in each
 * submodule. When this was found, `origin/master` was 118 commits behind the agent's
 * active branch and 42 behind the UI's — so the server was rebuilt, successfully and
 * with no warning, from an agent months older than the commit it had just pulled.
 * Nothing in the output said which revision was deployed, and the parent's recorded
 * pointers — the ones every gate and every CI run had validated against — were
 * discarded on the way in.
 *
 * The recorded pointer IS the statement of what was tested. A deploy that resolves
 * it against a moving branch is deploying something nobody validated.
 *
 * Every other invocation in this repository already used `--init --recursive`; this
 * checks that the one that did not cannot come back, in a script, a workflow, a
 * Dockerfile or a doc's copy-pasteable instructions.
 *
 * Not covered, and deliberately: `--remote` typed interactively by someone who wants
 * exactly that behaviour while bumping a pointer on purpose. This gate is about what
 * the repository INSTRUCTS, which is the part that runs unattended.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Directories whose contents are not ours to police. */
const SKIP_DIRS = new Set([
  'node_modules', 'target', '.git', 'dist', 'pkg', 'build', '.venv', 'coverage',
]);

/** Files that instruct: scripts, workflows, container builds, and documentation. */
const INTERESTING = /(\.sh|\.mjs|\.js|\.ya?ml|\.md|Dockerfile[^/]*)$/;

/** The invocation, allowing any flags between the verb and `--remote`. */
const REMOTE_UPDATE = /git\s+submodule\s+update\b[^\n`"']*--remote/;

/**
 * This file necessarily contains the very string it forbids, in its own header and
 * in the pattern above. Exempting it by path rather than by cleverness keeps the
 * pattern honest — a check that had to avoid matching itself would be a check
 * weakened to protect itself.
 */
const SELF = 'scripts/check-deploys-use-the-recorded-pointers.mjs';

function* files(dir) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry) || entry.startsWith('.') && entry !== '.github') continue;
    const full = join(dir, entry);
    let s;
    try { s = statSync(full); } catch { continue; }
    if (s.isDirectory()) { yield* files(full); continue; }
    if (INTERESTING.test(entry)) yield full;
  }
}

const offenders = [];
let scanned = 0;

for (const file of files(ROOT)) {
  const rel = relative(ROOT, file);
  if (rel === SELF) continue;
  scanned += 1;
  let text;
  try { text = readFileSync(file, 'utf8'); } catch { continue; }
  // In an EXECUTABLE file a comment cannot run, so a comment explaining why
  // `--remote` is wrong is the fix, not the defect. This gate's first run flagged
  // its own CI step's explanation. Markdown is different and is NOT exempted:
  // prose in a runbook is the instruction, which is how this reached a live
  // server in the first place.
  const executable = /(\.sh|\.mjs|\.js|\.ya?ml|Dockerfile[^/]*)$/.test(rel);
  const isComment = (line) => /^\s*(#|\/\/|\*|<!--)/.test(line);

  /**
   * In markdown, only an INSTRUCTION counts.
   *
   * A fenced block, a bullet, or a sentence beginning "Run"/"Use" is something a
   * reader is being told to do — that is how `--remote` reached the live server,
   * via a tip printed by check-submodule-status.sh and transcribed into a doc.
   *
   * A sentence that quotes the command while explaining why it is wrong is not.
   * Without this, the incident report in docs/ROBUSTNESS.md fails the very gate it
   * describes, and the only ways out are to stop writing the command down or to
   * exempt the file — both of which cost more than they save.
   */
  let inFence = false;
  const isInstruction = (line) => {
    if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; return false; }
    return inFence || /^\s*(?:[-*•+]|\d+[.)])\s/.test(line) || /^\s*(?:Run|Use)\b/i.test(line);
  };

  text.split('\n').forEach((line, i) => {
    if (executable && isComment(line)) return;
    if (!executable && !isInstruction(line)) return;
    // An instruction naming --remote only to warn against it is the fix, not the defect.
    if (/\bNOT\b[^\n]{0,40}--remote|never[^\n]{0,20}--remote/i.test(line)) return;
    if (REMOTE_UPDATE.test(line)) offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
  });
}

// Vacuity floor. If SKIP_DIRS or INTERESTING drifts so that nothing is read, this
// gate would report a clean tree having examined none of it. The repository has
// hundreds of such files; 50 is far below the real count and far above zero.
if (scanned < 50) {
  console.error(
    `FAIL: read only ${scanned} instructing file(s) — the walk or the extension list moved, ` +
      'so this gate examined essentially nothing.',
  );
  process.exit(1);
}

if (offenders.length > 0) {
  for (const o of offenders) console.error(`::error::${o}`);
  console.error(`\nFAIL: ${offenders.length} place(s) check submodules out with \`--remote\`.\n`);
  for (const o of offenders) console.error(`  ${o}`);
  console.error(
    '\nUse `git submodule update --init --recursive`, which checks out the commit this\n' +
      'repository RECORDS. `--remote` takes each submodule\'s branch tip instead, so the\n' +
      'deployed tree is not the tree that was tested — see the header of this file for the\n' +
      'incident: a live server rebuilt from an agent 118 commits stale, with no warning.',
  );
  process.exit(1);
}

console.log(
  `check-deploys-use-the-recorded-pointers: ${scanned} instructing file(s) scanned; ` +
    'every submodule checkout takes the recorded pointer.',
);
