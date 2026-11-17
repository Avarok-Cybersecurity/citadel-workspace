/**
 * A control you CLICK must not be found by the words on it.
 *
 * Five checks in one session failed because the app improved its wording, and
 * the most expensive of them took the whole reconnection family down for a
 * button that had said "Sign In" for months. Asserting on copy is often the
 * point — that is what a text assertion is for. *Addressing* a control by copy
 * in order to press it is a different thing: it is a lookup, and a lookup keyed
 * on prose breaks the moment the prose is improved, which taxes every
 * improvement.
 *
 * A ratchet, like the explicit-types gate: 110 sites exist today, so a wall
 * would just be switched off. A file may not gain sites; a file with none must
 * stay at none; any file that improves is written down immediately.
 *
 * Dynamic identity is a legitimate exception and is counted anyway: a peer's
 * username or a document's title is not a testid. The hybrid to move those to
 * is `[data-testid="peer-row"]:has-text(name)` — structure by testid, identity
 * by content — which still counts here, because it still contains the words.
 * The baseline is where that judgement is recorded.
 */
import { readdirSync, readFileSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve } from 'node:path';

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SPECS = join(APP, 'integration-tests', 'src');
const BASELINE = join(APP, 'scripts', 'copy-addressed-controls.baseline.json');
const WRITE = process.argv.includes('--write');

/**
 * A locator that finds a control by what it says.
 *
 * `getByRole` used to be matched as `{ name:` on a `'button'` only. Two things
 * slipped through, and both cost a CI leg:
 *
 *  - **`{ name }` shorthand.** `getByRole('button', { name })` inside a helper
 *    has no colon, so the check did not see it. `error-handling.spec.ts` waited
 *    ten seconds for a button reading "Connect" that had said "Sign In" for
 *    weeks, failed there, and never reached the error handling it was written
 *    to test.
 *  - **Roles other than button.** A link, tab or menuitem addressed by its
 *    words breaks in exactly the same way.
 *
 * An icon's class counts too. `button:has(svg.lucide-bell)` is not copy, but it
 * is identity-free in the same way: `lucide-bell` is an icon library's internal
 * name, nothing promises to keep it, and when it goes the click lands nowhere.
 * That is what happened to the notification centre at 375px — the sheet never
 * opened, so the tap-target and overflow checks below it never ran, and the
 * failure read as a missing dialog rather than as a missing button.
 */
const COPY_LOCATOR =
  /(has-text\(|getByText\(|getByRole\(\s*['"][a-z]+['"]\s*,\s*\{\s*name\b|filter\(\s*\{\s*hasText:|svg\.lucide-)/;
/** Something done TO a control, as opposed to asserted about it. */
const ACTION = /\.(click|fill|press|check|selectOption)\(/;

function sourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (entry.endsWith('.ts')) out.push(path);
  }
  return out;
}

/** Sites in one file where a copy-addressed locator is acted on. */
function copyAddressedActions(source) {
  const lines = source.split('\n');
  let count = 0;
  lines.forEach((line, index) => {
    if (COPY_LOCATOR.test(line) && ACTION.test(line)) {
      count += 1;
      return;
    }
    // Assigned first, pressed later — which is how most of them are written,
    // and what a line-by-line check would miss entirely.
    const assignment = /^\s*const\s+([A-Za-z_$][\w$]*)\s*[:=]/.exec(line);
    if (!assignment || !COPY_LOCATOR.test(line)) return;
    const within = lines.slice(index + 1, index + 40).join('\n');
    if (new RegExp(`\\b${assignment[1]}\\s*\\.(click|fill|press|check|selectOption)\\(`).test(within)) {
      count += 1;
    }
  });
  return count;
}

const counts = {};
const files = sourceFiles(SPECS);
if (files.length < 40) {
  console.error(`\n  Scanned only ${files.length} spec file(s) — the tree moved.\n`);
  process.exit(1);
}
for (const file of files) {
  const found = copyAddressedActions(readFileSync(file, 'utf-8'));
  if (found > 0) counts[relative(APP, file)] = found;
}
const total = Object.values(counts).reduce((sum, n) => sum + n, 0);

if (WRITE) {
  const previous = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf-8')) : {};
  const raised = Object.entries(counts).filter(([file, n]) => n > (previous[file] ?? 0));
  if (raised.length > 0 && !process.argv.includes('--allow-regressions')) {
    console.error(`\n  Refusing to write: ${raised.length} file(s) would go UP.\n`);
    for (const [file, n] of raised) console.error(`    ${file}: ${previous[file] ?? 0} → ${n}`);
    console.error('');
    process.exit(1);
  }
  writeFileSync(BASELINE, `${JSON.stringify(counts, null, 2)}\n`);
  console.log(`  Baseline written: ${Object.keys(counts).length} file(s), ${total} site(s).`);
  process.exit(0);
}

if (!existsSync(BASELINE)) {
  console.error('\n  No baseline. Run with --write once to record what exists.\n');
  process.exit(1);
}
const baseline = JSON.parse(readFileSync(BASELINE, 'utf-8'));
const baselineTotal = Object.values(baseline).reduce((sum, n) => sum + n, 0);

const regressions = [];
const improvements = [];
for (const [file, found] of Object.entries(counts)) {
  const allowed = baseline[file] ?? 0;
  if (found > allowed) {
    regressions.push(
      allowed === 0
        ? `${file}: ${found} control(s) pressed by their words, in a file that had none`
        : `${file}: ${found} control(s) pressed by their words, up from ${allowed}`,
    );
  } else if (found < allowed) improvements.push(`${file}: ${allowed} → ${found}`);
}
for (const file of Object.keys(baseline)) {
  if (!(file in counts)) improvements.push(`${file}: ${baseline[file]} → 0`);
}

if (regressions.length > 0) {
  console.error('\n  Controls addressed by copy and then pressed:\n');
  for (const regression of regressions) console.error(`    ${regression}`);
  console.error(
    '\n  Give the control a data-testid and address it by that. Asserting on copy is' +
    '\n  fine; finding a control by copy is what breaks when the copy improves.\n',
  );
  process.exit(1);
}

if (improvements.length > 0) {
  writeFileSync(BASELINE, `${JSON.stringify(counts, null, 2)}\n`);
  console.error(`\n  ${improvements.length} file(s) improved; baseline updated:\n`);
  for (const improvement of improvements.slice(0, 10)) console.error(`    ${improvement}`);
  console.error(`\n  Total: ${baselineTotal} → ${total}. Commit the baseline.\n`);
  process.exit(1);
}

console.log(`  Controls by testid: no new copy-addressed presses (${total} in the baseline)  ok`);
