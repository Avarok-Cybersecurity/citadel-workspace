/**
 * A spec may not search for words the app does not contain.
 *
 * Four rounds in a row were the same defect: a locator pinned to a label the
 * product improved. Each one cost a CI leg and read as something else entirely.
 *
 *   - `CONNECTED PEERS` -- the members list was given one noun, and from that
 *     day every P2P connection was reported as failed. Three sites.
 *   - `LIVE DOCS` / `Create Live Doc` -- `createLiveDoc` clicked nothing and
 *     honestly reported the document missing. The whole of test:live-doc.
 *   - `Edit MDX Content` -- the label became "Can edit MDX documents", and a
 *     375px layout guard stopped executing while its failure read as a broken
 *     test.
 *   - `Connect` -- the button says "Sign In". Three legs.
 *
 * None of these announces itself. A locator that matches nothing waits out its
 * timeout, or falls through to the next strategy, and the failure names the
 * feature rather than the string.
 *
 * The rule is not "never mention copy". Asserting that the UI SAYS something is
 * exactly right. The rule is that a string a spec searches for must exist in the
 * app, or be data the spec itself created, and the second case has to be said
 * out loud rather than assumed.
 *
 * WHAT THIS CANNOT SEE, stated plainly because a guard that overstates its reach
 * is worse than none:
 *
 *   1. WHICH SCREEN the string is on. It asks only whether the app contains it
 *      anywhere. `member-list-loading.spec.ts` searched the sidebar for
 *      "No members yet"; the sidebar has never said that, but `DirectoryTabContent`
 *      does, so this gate passed it — and the spec's one load-bearing assertion
 *      could not fail. Verified by control: restoring that exact locator today is
 *      still reported as clean. Only the testid check below catches it, because
 *      `members-empty` belongs to one component.
 *   2. Regex locators (`/No members yet/i`), which are not reconstructible here.
 *   3. `getByRole(..., { name })`, and attribute selectors like `#server`.
 *
 * 2 and 3 are open. They are the forms the suite increasingly prefers, so the
 * coverage here is narrower than the file name suggests.
 */
import { readFileSync } from 'node:fs';
import { readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chosenTestIds, domSetTestIds } from './lib/chosen-testids.mjs';

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(APP, 'src');
const SPECS = join(APP, 'integration-tests', 'src');

/**
 * Strings the suite searches for that the app legitimately does not contain,
 * each with the reason it is here. A string earns a place by somebody deciding
 * it belongs, not by nobody noticing.
 */
const CREATED_BY_THE_TEST = new Map([
  ['Test Alert 1', 'a notification the notification-center spec raises itself'],
  ['Test Alert 2', 'as above'],
  ['Test Alert 3', 'as above'],
  // Rendered from a server error message, not from a literal in this bundle.
  // The UI shows `err.message`, and the text is built by the Rust kernel --
  // `citadel-workspace-server-kernel/src/handlers/domain/core.rs:26` formats
  // "Permission denied: {msg}", and workspace_errors.rs:10 pins one such
  // constant. So this locator does match at runtime, and no amount of reading
  // the client can show that.
  //
  // Recorded rather than deleted BECAUSE it is unverifiable here: this gate
  // can prove a string is absent from the client, not that it is absent from
  // the screen. Saying so is the honest limit of what it measures.
  ['Permission denied', 'formatted by the server kernel, not present in the client bundle'],
]);

function filesUnder(dir, extensions) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...filesUnder(path, extensions));
    else if (extensions.some((ext) => entry.endsWith(ext))) out.push(path);
  }
  return out;
}

function withoutComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

// Comments stripped from the APP corpus too, not only from the specs.
//
// Without this a locator was satisfied by a sentence ABOUT the copy rather
// than the copy. Three passed that way, and one of them searched for text the
// app had deliberately REMOVED -- the only remaining occurrence of
// "Connected Peers" is a doc comment explaining that the label is gone.
//
// The whole point of this gate is that a locator matching nothing does not
// fail; it waits and falls through. A gate that a comment can satisfy has the
// same shape as the bug it is looking for.
const appText = filesUnder(SRC, ['.ts', '.tsx'])
  .filter((f) => !f.includes('__tests__') && !f.includes('.test.'))
  .map((f) => withoutComments(readFileSync(f, 'utf-8')))
  .join('\n');

const LITERAL = /(?:has-text|:text|getByText)\(\s*["'`]([^"'`]{3,40})["'`]|text=["']([^"']{3,40})["']/g;

/**
 * `getByTestId('x')`, and the constants specs hold one in.
 *
 * A testid is the form this gate RECOMMENDS as the fix for stale copy, and it was
 * the one form the gate could not check. `member-list-loading.spec.ts` searched
 * `getByText(/No members yet/i)` for a sidebar whose empty state has always read
 * "Nobody else is here yet" — so its single load-bearing assertion,
 * `expect(sawEmptyState).toBe(false)`, could not fail, and the loading fix it
 * guards could be reverted whole while it stayed green. Moving it to a testid is
 * only an improvement if the testid is checked too; otherwise it is the same
 * defect written more confidently.
 *
 * The regex form (`/No members yet/i`) that hid the original is still unparsed
 * here — noted, not fixed, because a regex can legitimately match copy this gate
 * cannot reconstruct. That is a real limit of this check and is written down
 * rather than implied.
 */
const TESTID = /getByTestId\(\s*["'`]([A-Za-z0-9_-]{2,60})["'`]\s*\)|TESTID(?:\w*)\s*(?::\s*string\s*)?=\s*["'`]([A-Za-z0-9_-]{2,60})["'`]/g;

/**
 * `locator('#some-id')` and `locator('.some-class')`.
 *
 * `login-flow.spec.ts` located its error element with `.text-red-400`, a class
 * that appears NOWHERE in the app — `components/Login.tsx` renders the inline
 * error as `id="login-error"` with `text-destructive-emphasis`. The locator
 * matched nothing, so the whole error branch was unreachable and the helper's
 * `return true` was unconditional: a failed login reported success, and the
 * session-claim recovery inside that branch never ran.
 *
 * A colour class is the worst thing to pin a test to. It changes for purely
 * visual reasons, with no behaviour change to notice, and the resulting failure
 * is silence rather than an error.
 *
 * Only single-token selectors are read. A compound like `.a .b` or `div.c` is a
 * structural query this cannot resolve, and guessing at it would produce the
 * invented findings that get a gate switched off.
 */
const CSS_SELECTOR = /locator\(\s*["'`]([#.][A-Za-z0-9_-]{2,60})["'`]\s*\)/g;

/**
 * Selectors known to match nothing, each with why it is still here.
 *
 * These are RECORDED, not excused: a locator that matches nothing is a finding
 * whether or not anyone is ready to fix it, and writing the reason down is what
 * stops the next reader assuming it was checked and found fine.
 */
const KNOWN_DEAD_SELECTORS = new Map([
  [
    '#server',
    'a fallback for a server-address input on the LOGIN form. That form has none — ' +
      'LoginAdvancedOptions holds only security settings and the passkey-enrol switch, and the ' +
      'address is chosen on Landing\'s server step. Its primary selector, ' +
      'input[placeholder*="127.0.0.1:12349"], is dead for the same reason. The surrounding ' +
      'code already degrades and logs, so this is obsolete rather than broken; removing it ' +
      'needs the login flow re-read, which is more than a selector fix.',
  ],
  [
    '.text-red-400',
    'native-file-picker.test.ts reads the file-picker modal\'s error. The class exists ' +
      'nowhere in the app, so the branch is dead — but unlike the login and init-modal cases ' +
      'the modal has no addressable error element to point at yet, and inventing one here ' +
      'without being able to run the spec would be a guess.',
  ],
]);

/**
 * Every `data-testid` the app renders, in all four spellings it uses.
 *
 * The JSX attribute is the common one, but a testid is also passed as an OBJECT
 * PROPERTY when it is spread onto a child — `'data-testid': \`preview-region-${id}\``
 * in `components/theme/ThemePreview.tsx`. Reading only the attribute form made
 * this gate's first run accuse three specs of addressing `preview-region-sidebar`,
 * which the app renders perfectly well. A check that invents findings gets
 * disabled, and then it catches nothing at all.
 *
 * Templated ids contribute their literal PREFIX, so `preview-region-` admits
 * `preview-region-sidebar` without this gate having to evaluate the expression.
 */
const appTestIds = new Set();
/**
 * Prefixes are kept SEPARATE from complete ids, and only a prefix may be extended.
 *
 * The first version matched an id if it started with any known id, which meant a
 * real `members-empty` admitted `members-empty-nonexistent`. Its negative control
 * caught that: changing the spec's testid to a name the app has never rendered left
 * the gate reporting "ok". A check whose failure mode is "close enough" is the same
 * check that let the original stale locator through.
 */
const appTestIdPrefixes = new Set();
for (const m of appText.matchAll(/data-testid["']?\s*[=:]\s*["'`]([^"'`$]+)["'`]/g)) appTestIds.add(m[1]);
for (const m of appText.matchAll(/data-testid["']?\s*[=:]\s*\{?\s*`([^`$]*)/g)) if (m[1]) appTestIdPrefixes.add(m[1]);
for (const id of chosenTestIds(appText)) appTestIds.add(id);
for (const id of domSetTestIds(appText)) appTestIds.add(id);
// A `testId` PROP forwarded to `data-testid` by a wrapper — `CallControls.tsx`
// passes `testId="call-toggle-mic"` to a local `ToggleButton` whose JSX ends in
// `data-testid={testId}`. The rendered id is real; only the literal's spelling
// differs. Accepted because a wrapper is the normal way to keep an accessible
// button's markup in one place, and refusing it would push authors back to copy.
for (const m of appText.matchAll(/\btestId\s*=\s*["'`]([^"'`$]+)["'`]/g)) appTestIds.add(m[1]);

/**
 * Ids and classes the app really renders — including the two ways it does so
 * without writing the literal.
 *
 * The first version of this reported three findings the app renders perfectly
 * well, which is the ratio that gets a gate switched off:
 *
 *   - `#username-error`, `#password-error`, `#confirmPassword-error`. Rendered by
 *     `JoinFormFields.tsx:99` as ``id={`${id}-error`}``, so the literal in the
 *     source is only the SUFFIX. Template fragments are collected below and a
 *     spec id is admitted if it ends with one.
 *   - `.ProseMirror`, which no `className` in this app writes: it comes from
 *     TipTap/ProseMirror at runtime. The evidence that it exists is that the app
 *     itself queries it (`LiveDocumentView.tsx:46`), so a class the app SELECTS
 *     counts as one the app has.
 */
const appIds = new Set();
for (const m of appText.matchAll(/\bid=["'`]([A-Za-z0-9_-]+)["'`]/g)) appIds.add(m[1]);

/** Literal fragments of a templated id, e.g. `-error` from ``id={`${id}-error`}``. */
const appIdFragments = new Set();
for (const m of appText.matchAll(/\bid=\{`([^`]+)`\}/g)) {
  for (const piece of m[1].split(/\$\{[^}]*\}/)) {
    const frag = piece.trim();
    if (frag.length >= 2) appIdFragments.add(frag);
  }
}

const appClasses = new Set();
for (const m of appText.matchAll(/className=\{?["'`]([^"'`]+)["'`]/g)) {
  for (const cls of m[1].split(/\s+/)) if (cls) appClasses.add(cls.replace(/^.*:/, ''));
}
// A class the APP queries is one the app has, whoever puts it in the DOM.
for (const m of appText.matchAll(/querySelector(?:All)?\(\s*["'`]\.([A-Za-z0-9_-]+)["'`]/g)) {
  appClasses.add(m[1]);
}
if (appTestIds.size === 0) {
  console.error('\n  FAIL: found no data-testid in the app at all — the corpus or the pattern moved.\n');
  process.exit(1);
}
/**
 * Exact match, or an extension of a TEMPLATED prefix (`preview-region-${id}`).
 * Nothing else: a complete id does not vouch for longer names built from it.
 */
const testIdExists = (id) =>
  appTestIds.has(id) || [...appTestIdPrefixes].some((prefix) => prefix.length > 0 && id.startsWith(prefix));

const findings = [];
let literalsSeen = 0;
let testIdsSeen = 0;
let selectorsSeen = 0;
for (const file of filesUnder(SPECS, ['.ts'])) {
  const source = withoutComments(readFileSync(file, 'utf-8'));
  for (const match of source.matchAll(LITERAL)) {
    const literal = (match[1] ?? match[2] ?? '').trim();
    // Interpolated, or a selector rather than copy.
    if (!literal || literal.includes('$') || /^[.[#]/.test(literal)) continue;
    literalsSeen += 1;
    if (appText.includes(literal)) continue;
    if (CREATED_BY_THE_TEST.has(literal)) continue;
    findings.push(`${relative(APP, file)}: searches for ${JSON.stringify(literal)}`);
  }
  for (const match of source.matchAll(CSS_SELECTOR)) {
    const selector = match[1];
    selectorsSeen += 1;
    const bare = selector.slice(1);
    if (KNOWN_DEAD_SELECTORS.has(selector)) continue;
    const known = selector.startsWith('#')
      ? appIds.has(bare) || [...appIdFragments].some((frag) => bare.endsWith(frag))
      : appClasses.has(bare);
    if (known) continue;
    findings.push(
      `${relative(APP, file)}: locates ${JSON.stringify(selector)}, which the app never renders`,
    );
  }
  for (const match of source.matchAll(TESTID)) {
    const id = (match[1] ?? match[2] ?? '').trim();
    if (!id) continue;
    testIdsSeen += 1;
    if (testIdExists(id)) continue;
    findings.push(`${relative(APP, file)}: addresses data-testid ${JSON.stringify(id)}, which the app never renders`);
  }
}

// Vacuity floor. Either pattern silently ceasing to match would leave this gate
// reporting a clean suite over locators it never read — the exact shape of the
// defect it exists to find.
if (literalsSeen === 0 || testIdsSeen === 0) {
  console.error(
    `\n  FAIL: parsed ${literalsSeen} copy locator(s) and ${testIdsSeen} testid locator(s).\n` +
      '  A zero on either means the pattern stopped matching, not that the suite is clean.\n',
  );
  process.exit(1);
}

if (findings.length > 0) {
  console.error(`\n  ${findings.length} spec locator(s) search for words the app does not contain:\n`);
  for (const finding of [...new Set(findings)].slice(0, 20)) console.error(`    ${finding}`);
  console.error(
    '\n  Address the control by a data-testid, or -- if the string is data the\n' +
      '  spec itself created -- add it to CREATED_BY_THE_TEST with the reason.\n' +
      '  A locator that matches nothing does not fail; it waits, or falls through.\n',
  );
  process.exit(1);
}

console.log(
  `  Spec copy: ${literalsSeen} copy locator(s) and ${testIdsSeen} testid locator(s) across the suite ` +
    `all resolve against the app's ${appTestIds.size} testids  ok`,
);
