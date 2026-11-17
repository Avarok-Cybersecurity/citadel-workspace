/**
 * A control's enabled state comes from `usePermission`, not from `hasPermission`.
 *
 * `usePermission` carries three things that took a round each to get right: a
 * bounded retry, so one fetch that came back empty during start-up does not
 * refuse a control for the life of the page; a reset on reconnection and on a
 * session change, so a budget spent too early is spent again at the moment the
 * answer may differ; and a reason that distinguishes "the answer was no" from
 * "we never got an answer", which is the difference between a permission to
 * request and a fault to report.
 *
 * `hasPermission` from `usePermissions()` has none of them. It reads the cache,
 * and a domain nobody loaded reads exactly like a denial.
 *
 * `WorkspaceAppearanceSection` gated on it behind its own fetch-once effect,
 * and so the workspace's own owner could be shown a read-only theme editor
 * captioned "Set by a workspace admin", permanently, because one request went
 * out before the tab knew who was signed in. Every part of that already had a
 * fix. It was the second gate, and it had inherited none of them.
 *
 * So: reading permission state to DISPLAY it is fine — a permission matrix has
 * to render what the cache holds. Reading it to decide whether a control works
 * is not, and any file that needs to must say why here.
 *
 * That was necessary and NOT SUFFICIENT. `usePermission` returned `allowed:
 * false` on a cache miss too, so three consumers that had obeyed this rule
 * still refused users things they were entitled to: the office composer had
 * three of the four not-a-denial states, the theme editor had two, and
 * `BaseOffice` had none. Four states are not "no" — allowed, loading,
 * unanswered, and no stored answer — and spelling them at each call site is how
 * they drifted apart.
 *
 * The second rule, therefore: a file that GATES on `usePermission` must ask
 * `permits(...)`, which is that expression in one place.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve } from 'node:path';

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Files that read permission state directly, and why that is not a gate.
 * Adding one is a decision, not a formality: say what it renders.
 */
const DISPLAYS_RATHER_THAN_GATES = new Map([
  [
    'src/components/settings/PermissionWidgets.tsx',
    'renders the permission matrix itself — the cache IS the subject, not an input to a decision',
  ],
]);

const CALLS = /\b(hasPermission|hasAnyPermission|hasAllPermissions)\s*\(/;

/**
 * Walked rather than globbed.
 *
 * `globSync` from `node:fs` arrived in Node 22, and the lint job that runs this
 * is pinned to Node 20 — so it threw `does not provide an export named
 * globSync` and took the ESLint jobs for all three projects down with it. It
 * passed locally because this shell runs 22. A gate must not need a newer
 * runtime than the job it runs in.
 */
function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue;
    const full = join(dir, entry);
    let info;
    try { info = statSync(full); } catch { continue; }
    if (info.isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(relative(APP, full));
  }
  return out;
}

const files = walk(join(APP, 'src'))
  .filter((f) => !f.includes('__tests__') && !f.includes('.test.'))
  // The mechanism itself, and the context that exposes it.
  .filter((f) => !f.startsWith('src/hooks/use-permission') && !f.startsWith('src/lib/permissions-service/'))
  .filter((f) => f !== 'src/contexts/PermissionsContext.tsx');

const offenders = [];
/** Files that gate on usePermission without going through `permits`. */
const spelledOut = [];
for (const file of files) {
  const source = readFileSync(resolve(APP, file), 'utf-8');

  if (/\busePermission\s*\(/.test(source) && !DISPLAYS_RATHER_THAN_GATES.has(file)) {
    // Reading `.allowed` (or destructuring it) is what a gate does. A file that
    // only passes the whole result around is not deciding anything here.
    const readsAllowed = /allowed\s*:/.test(source) || /\.allowed\b/.test(source);
    if (readsAllowed && !/\bpermits\s*\(/.test(source)) spelledOut.push(file);
  }

  if (!CALLS.test(source)) continue;
  if (DISPLAYS_RATHER_THAN_GATES.has(file)) continue;
  offenders.push(file);
}

if (spelledOut.length > 0) {
  console.error('\n  A permission gate must ask permits(), not allowed:\n');
  for (const file of spelledOut) {
    console.error(
      `::error file=citadel-workspaces/${file}::${relative('src', file)} decides on \`allowed\` alone. ` +
        'Four states are not the answer "no" -- allowed, loading, unanswered, and no stored answer at all -- ' +
        'and `permits()` in hooks/use-permission-result.ts is that expression in one place.',
    );
  }
  process.exit(1);
}

if (offenders.length > 0) {
  console.error('\n  Permission gates must go through usePermission:\n');
  for (const file of offenders) {
    console.error(`::error file=citadel-workspaces/${file}::${relative('src', file)} reads permission state directly`);
  }
  console.error(
    '\n  usePermission carries the retry, the reset-on-reconnect and the "we never\n' +
    '  got an answer" reason. hasPermission has none of them, and a domain nobody\n' +
    '  loaded reads exactly like a denial.\n\n' +
    '  If the file DISPLAYS permission state rather than gating on it, add it to\n' +
    '  DISPLAYS_RATHER_THAN_GATES in this script with what it renders.\n',
  );
  process.exit(1);
}

console.log(`  Permission gates: ${files.length} file(s) checked, ${DISPLAYS_RATHER_THAN_GATES.size} display-only  ok`);
