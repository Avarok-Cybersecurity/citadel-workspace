#!/usr/bin/env node
/**
 * Fails if an icon-only Button has no accessible name.
 *
 * axe reports these as `critical button-name`, but only for buttons that are
 * ON SCREEN during a scan. Seven were found in one sweep here and only ONE of
 * them was reachable by the accessibility suite: the composer's send button.
 * The others sit behind state the scans never reach — message action menus
 * need messages, and a freshly registered workspace has none, so the Messages
 * scan renders an empty thread and passes.
 *
 * A green axe run therefore says nothing about the rest of them, which is why
 * this checks the source instead of the DOM.
 *
 * An icon-only Button is `<Button ... size="icon">` whose children render no
 * text. Any of aria-label, title, or an .sr-only child counts as a name.
 *
 * Pure file reads: no toolchain, no browser, no network.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'citadel-workspaces', 'src');

if (!existsSync(SRC)) {
  // A guard that cannot find what it guards has verified NOTHING, so this is a
  // failure, not a skip. Every CI job that runs these uses
  // `submodules: recursive`, so an absent path means a broken checkout — which
  // used to be reported as a pass.
  console.error('check-icon-button-names: citadel-workspaces/src is missing, so nothing was checked.');
  process.exit(1);
}

/** Every .tsx under src, excluding tests. */
function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      if (entry === '__tests__' || entry === 'test') continue;
      out.push(...walk(p));
    } else if (entry.endsWith('.tsx')) {
      out.push(p);
    }
  }
  return out;
}

const offenders = [];
let scanned = 0;

/**
 * Read a JSX opening tag's attributes, respecting braces, quotes and comments.
 *
 * The previous version used `<Button\b((?:[^>]|\n)*?)>`, whose attribute
 * capture stops at the FIRST `>` — which, for any button carrying
 * `onClick={() => ...}`, is the `>` inside the arrow. The handler body then
 * landed in the "children" half, and the text check below counted code like
 * `setVisible(false)}` as the button's visible label. The guard therefore
 * passed every unnamed icon button with an inline arrow handler, which is
 * nearly all of them: it reported "all 39 have an accessible name" while four
 * shipped nameless, including a destructive per-row remove control.
 *
 * Returns the attribute text, whether the tag self-closes, and where it ends.
 */
function readOpeningTag(source, start) {
  let depth = 0;
  let quote = null;
  for (let i = start; i < source.length; i += 1) {
    const c = source[i];
    if (quote) {
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '{') { depth += 1; continue; }
    if (c === '}') { depth -= 1; continue; }
    if (depth > 0) continue;
    if (c === '>') {
      const selfClosing = source[i - 1] === '/';
      return { attrs: source.slice(start, selfClosing ? i - 1 : i), end: i, selfClosing };
    }
  }
  return null;
}

/** An attribute present AND non-empty. `aria-label=""` names nothing. */
function hasNonEmpty(attrs, name) {
  const quoted = new RegExp(`${name}\\s*=\\s*["'\`]([^"'\`]*)["'\`]`).exec(attrs);
  if (quoted) return quoted[1].trim().length > 0;
  // An expression value cannot be judged statically; treat it as a name.
  return new RegExp(`${name}\\s*=\\s*\\{`).test(attrs);
}

for (const file of walk(SRC)) {
  const source = readFileSync(file, 'utf8');
  // Both the styled Button and native <button>: the old guard saw only the
  // former, and only when literally `size="icon"`, so the file-manager
  // toolbar's icon-only `size="sm"` buttons were invisible to it.
  for (const match of source.matchAll(/<(Button|button)\b/g)) {
    const tagName = match[1];
    const open = readOpeningTag(source, match.index + match[0].length);
    if (!open) continue;

    let inner = '';
    if (!open.selfClosing) {
      const close = source.indexOf(`</${tagName}>`, open.end);
      if (close === -1) continue;
      inner = source.slice(open.end + 1, close);
    }

    // Icon-only means the children are NOTHING BUT self-closing elements.
    //
    // Stripping JSX expressions instead would call `{loading ? <Spinner/> :
    // 'Save'}` textless and flag 50-odd buttons that do have visible labels.
    // A conditional that MIGHT render only an icon is not worth a false
    // positive here; the shape below is the one that is always nameless.
    const iconOnly = /^(?:\s*<[A-Za-z][\w.]*(?:\s[^<>]*?)?\/>\s*)+$/.test(inner);
    if (!iconOnly) continue;
    scanned += 1;

    // A spread can carry aria-label (ThemePreview's `hotspot()` does exactly
    // that), and its contents cannot be judged from here. Exempted knowingly:
    // this is the guard's one blind spot, and a false accusation would push
    // someone to add a duplicate label.
    if (/\{\s*\.\.\./.test(open.attrs)) continue;
    if (hasNonEmpty(open.attrs, 'aria-label')) continue;
    if (hasNonEmpty(open.attrs, 'aria-labelledby')) continue;
    if (hasNonEmpty(open.attrs, 'title')) continue;
    if (/sr-only/.test(inner)) continue;

    const line = source.slice(0, match.index).split('\n').length;
    offenders.push(`${relative(ROOT, file)}:${line}`);
  }
}

if (offenders.length > 0) {
  console.error(
    `check-icon-button-names: ${offenders.length} icon-only Button(s) render no text and have no accessible name.\n` +
      'A screen reader announces nothing for these. Add aria-label (and aria-hidden on the icon).\n',
  );
  for (const o of offenders) console.error(`  ${o}`);
  console.error('');
  process.exit(1);
}

console.log(`check-icon-button-names: OK — all ${scanned} icon-only Button(s) have an accessible name.`);
