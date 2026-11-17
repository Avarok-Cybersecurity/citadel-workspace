#!/usr/bin/env node
/**
 * Every `data-testid` a spec addresses is rendered by the app.
 *
 * `check-controls-are-addressed-by-testid.mjs` argues the other direction: do
 * not press a control by the words on it, give it a testid. Nothing checked
 * that the testid then EXISTS. So a spec could address `workspace-switcher`
 * and `workspace-name`, neither of which the app renders, and the lookup would
 * simply match nothing -- three seconds of waiting per run, then a fallback on
 * a chevron's CSS class, with the intended path permanently dead.
 *
 * That is the same shape as the `peer-row` heading and the Deregister/Disconnect
 * button labels: a selector that cannot match reads exactly like a feature that
 * is broken, and a fallback makes it read like one that works.
 *
 * Testids reach the DOM four ways here, and this check learned each one the
 * hard way while being written -- every widening removed false positives, not
 * real ones:
 *
 *   data-testid="x"                    a plain attribute
 *   data-testid={`x-${id}`}            a JSX template, matched by prefix
 *   testId: "x"  /  testId="x"         a config object or prop (LoadingModal)
 *   'data-testid': `x-${id}`           a quoted property key (ThemePreview)
 */
import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';
import { chosenTestIds, domSetTestIds } from './lib/chosen-testids.mjs';

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '..');
const SRC = join(ROOT, 'src');
const SPECS = join(ROOT, 'integration-tests', 'src');
/**
 * The parent repository's browser-driving scripts address testids too, and
 * nothing was checking them.
 *
 * `scripts/check-production-image.mjs` presses `create-account-button` and
 * `onboarding-intent-admin`; `scripts/prove-users-can-talk.mjs` is the proof
 * run before telling somebody a deployment is ready, and it presses eight of
 * them. A rename in this repo silently breaks either one, and both fail in the
 * way that is hardest to read: a lookup that matches nothing looks exactly
 * like a product that is broken.
 *
 * That is the same rule enforced in one of the two places its mechanism
 * appears -- the most common defect class in this tree. The parent is at
 * `../` from here in both topologies that matter: the submodule checkout, and
 * this repo's own CI, which clones the parent to `parent/` and this repo to
 * `parent/citadel-workspaces`. A standalone clone of this repo alone has no
 * parent, which is legitimate, so a missing directory narrows the scan instead
 * of failing -- and the success line below REPORTS how many roots were read,
 * so the narrowing cannot happen quietly.
 */
const PARENT_SCRIPTS = join(ROOT, '..', 'scripts');
const REFERENCE_ROOTS = [
  { dir: SPECS, pattern: /\.ts$/ },
  { dir: PARENT_SCRIPTS, pattern: /\.mjs$/ },
].filter((root) => existsSync(root.dir));

/**
 * Testids specs address that the app does not render.
 *
 * **Empty, and that is the point.** It started at eight, each inside a fallback
 * union -- `[data-testid="x"], .x` -- where the spec kept working through the
 * other half while this half matched nothing. Round 420 showed the cost: a
 * folder whose deletion had been removed from the tree, persisted AND
 * acknowledged by the peer still read as "still visible in tree", because the
 * surviving half of the union matched a path label.
 *
 * They closed in both directions, which is worth remembering the next time one
 * appears. Five became real names on real elements -- the group conversation
 * log, each message, the direct-message surface, the hierarchy section, the
 * workspace switcher. Three were deleted instead, because the app rendering a
 * name nothing needs is inventing surface to justify a dead reference.
 *
 * An entry here should be rare and temporary. The list may only SHRINK.
 */
const KNOWN_MISSING = new Set([
]);

function* files(dir, re) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry !== 'node_modules' && entry !== 'dist') yield* files(full, re);
    } else if (re.test(entry)) yield full;
  }
}

const defined = new Set();
const prefixes = [];

for (const file of files(SRC, /\.tsx?$/)) {
  const s = readFileSync(file, 'utf8');
  for (const m of s.matchAll(/data-testid\s*=\s*["']([^"']+)["']/g)) defined.add(m[1]);
  for (const m of s.matchAll(/data-testid=\{`([^`]+)`\}/g)) prefixes.push(m[1].split('${')[0]);
  for (const m of s.matchAll(/testId\s*[:=]\s*["']([^"']+)["']/g)) defined.add(m[1]);
  for (const m of s.matchAll(/testId=\{`([^`]+)`\}/g)) prefixes.push(m[1].split('${')[0]);
  for (const m of s.matchAll(/['"]data-testid['"]\s*:\s*["']([^"']+)["']/g)) defined.add(m[1]);
  for (const m of s.matchAll(/['"]data-testid['"]\s*:\s*`([^`]+)`/g)) prefixes.push(m[1].split('${')[0]);
  for (const id of chosenTestIds(s)) defined.add(id);
  for (const id of domSetTestIds(s)) defined.add(id);
}

const referenced = new Map();
/** `tree-item-${name}` in a spec: the PREFIX must be something the app renders. */
const referencedPrefixes = new Map();
for (const { dir, pattern } of REFERENCE_ROOTS)
for (const file of files(dir, pattern)) {
  const s = readFileSync(file, 'utf8');
  for (const m of s.matchAll(/getByTestId\(\s*["'`]([^"'`]+)["'`]|data-testid="([^"]+)"/g)) {
    const id = m[1] ?? m[2];
    if (!id) continue;
    // A templated reference. The first draft skipped these, and that is how
    // `tree-item-${folderName}` went unnoticed: the file manager's spec had
    // addressed it all along and the app rendered no such testid anywhere, so
    // every lookup fell through to a shared CSS class.
    if (id.includes('${')) {
      const prefix = id.split('${')[0];
      if (prefix && !referencedPrefixes.has(prefix)) referencedPrefixes.set(prefix, relative(ROOT, file));
      continue;
    }
    if (!referenced.has(id)) referenced.set(id, relative(ROOT, file));
  }
}

const problems = [];
const stillMissing = new Set(KNOWN_MISSING);

for (const [id, where] of referenced) {
  const exists = defined.has(id) || prefixes.some((p) => p && id.startsWith(p));
  if (exists) {
    if (KNOWN_MISSING.has(id)) {
      problems.push([id, `now rendered by the app (${where} addresses it); remove it from KNOWN_MISSING`]);
    }
    stillMissing.delete(id);
    continue;
  }
  stillMissing.delete(id);
  if (!KNOWN_MISSING.has(id)) {
    problems.push([id, `addressed by ${where}, rendered nowhere; that lookup cannot match`]);
  }
}

for (const [prefix, where] of referencedPrefixes) {
  const exists =
    prefixes.some((p) => p && (p.startsWith(prefix) || prefix.startsWith(p))) ||
    [...defined].some((d) => d.startsWith(prefix));
  if (!exists && !KNOWN_MISSING.has(prefix)) {
    problems.push([`${prefix}\${...}`, `addressed by ${where}, and the app renders no testid starting with "${prefix}"`]);
  }
  stillMissing.delete(prefix);
}

for (const gone of stillMissing) {
  problems.push([gone, 'listed as known-missing but no spec addresses it any more; remove it from KNOWN_MISSING']);
}

if (problems.length > 0) {
  console.error('\n  Test ids that do not exist:\n');
  for (const [id, why] of problems) console.error(`::error::${id} — ${why}`);
  console.error(
    '\n  Give the element the testid, or stop addressing it by one. A selector\n' +
    '  that cannot match reads exactly like a broken feature, and a fallback\n' +
    '  beside it makes it read like a working one.\n',
  );
  process.exit(1);
}

// Name the roots that were read. If a checkout has no parent beside it the
// scan narrows silently otherwise, and a gate that quietly stops reading half
// its input reports safety it did not measure.
const roots = REFERENCE_ROOTS.map((r) => relative(ROOT, r.dir)).join(', ');
console.log(`  Test ids: ${referenced.size} addressed across ${REFERENCE_ROOTS.length} root(s) (${roots}), all rendered  ok`);
