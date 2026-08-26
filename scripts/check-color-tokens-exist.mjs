#!/usr/bin/env node
/**
 * Every `bg-*` / `text-*` / `border-*` token a component uses must exist in
 * the Tailwind colour config.
 *
 * `--popover` and `--popover-foreground` were defined in index.css, and
 * `popover` was missing from tailwind.config's colors — so `.bg-popover` was
 * never generated and twenty Radix popper surfaces rendered fully
 * transparent. Nothing catches that: Tailwind emits no warning for an unknown
 * utility, tsc does not read classNames, and eslint has no idea. The symptom
 * (a see-through menu) was patched at 27 individual call sites with a local
 * background override, which is what let it survive.
 *
 * The `sidebar-*` family is the same bug still live: classes referencing
 * colours defined in neither the config nor index.css, so the shared
 * SidebarMenuButton contributes no hover, no pressed and no selected state.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const CONFIG = 'citadel-workspaces/tailwind.config.ts';
const ROOT = 'citadel-workspaces/src';

const config = readFileSync(CONFIG, 'utf8');
const colorsBlock = config.slice(config.indexOf('colors: {'));
// Top-level colour keys: `name: {` or `name: "..."`.
const known = new Set([...colorsBlock.matchAll(/^\s{8}"?([a-z][a-z-]*)"?:\s*[{"]/gm)].map((m) => m[1]));
// Tailwind ships these regardless of the extend block.
for (const c of ['white', 'black', 'transparent', 'current', 'inherit', 'slate', 'gray', 'zinc',
  'neutral', 'stone', 'red', 'orange', 'amber', 'yellow', 'lime', 'green', 'emerald', 'teal',
  'cyan', 'sky', 'blue', 'indigo', 'violet', 'purple', 'fuchsia', 'pink', 'rose']) known.add(c);

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (full.endsWith('.tsx') || full.endsWith('.ts')) yield full;
  }
}

// Only scan class strings, not prose: a bare regex over the file matches
// words inside comments ("bg-" never appears there, but "text-mode-forwards"
// does via animation-fill-mode).
const CLASS_STRING = /(?:className|cn|cva|clsx)\s*[=(]\s*(?:\{)?\s*["'`]([^"'`]+)["'`]/g;
const EXTRA_STRINGS = /["'`]((?:[a-z-]+:)?(?:bg|text|border|ring)-[a-z][^"'`]*)["'`]/g;

// Sub-utilities whose next segment is a direction or keyword, not a colour.
const SUBUTIL = /^(?:gradient|offset|t|r|b|l|x|y|s|e|opacity|width|spacing|size|wrap|balance|pretty|clip|ellipsis|nowrap|left|right|center|justify|start|end|top|bottom|solid|dashed|dotted|double|none|hidden|inner|auto|full|px|current|transparent|inherit)$/;

// Suffixes that are sizes or keywords rather than colours. `text-` in
// particular is both a font-size and a colour utility.
const KEYWORD = new Set(['xs', 'sm', 'base', 'md', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl', '6xl',
  '7xl', '8xl', '9xl', 'collapse', 'separate', 'no-repeat', 'repeat', 'repeat-x', 'repeat-y',
  'to-r', 'to-l', 'to-t', 'to-b', 'to-tr', 'to-tl', 'to-br', 'to-bl', 'mode-forwards',
  'mode-backwards', 'mode-both', 'mode-none', 'wrap', 'nowrap', 'balance', 'pretty', 'clip',
  'ellipsis', 'left', 'right', 'center', 'justify', 'start', 'end', 'contain', 'cover', 'text', 'clip-text', 'clip-border', 'clip-padding', 'clip-content', 'auto', 'fixed', 'local', 'scroll']);

function tokensIn(classString) {
  const out = [];
  for (const raw of classString.split(/\s+/)) {
    // strip variants (hover:, md:, dark:, group-hover:, data-[…]:)
    const bare = raw.replace(/^(?:[a-z0-9-]+:|\[[^\]]*\]:|(?:group|peer)-[a-z-]+(?:\/[a-z0-9-]+)?:)+/g, '');
    const m = /^(?:bg|text|border|ring|fill|stroke|decoration|outline|divide|accent|caret|placeholder|shadow|from|via|to)-(.+)$/.exec(bare);
    if (!m) continue;
    let rest = m[1].replace(/\/[0-9.]+$/, '').replace(/^\[.*\]$/, '');
    if (!rest) continue;
    let head = rest.split('-')[0];
    // border-t-primary, ring-offset-card, bg-gradient-to-r → drop the sub-utility
    while (SUBUTIL.test(head)) {
      rest = rest.slice(head.length + 1);
      if (!rest) { head = ''; break; }
      head = rest.split('-')[0];
    }
    if (!head) continue;
    if (/^\d/.test(rest)) continue;
    if (KEYWORD.has(rest)) continue;
    out.push(rest);
  }
  return out;
}

const offenders = new Map();
for (const file of walk(ROOT)) {
  if (file.includes('__tests__')) continue;
  const src = readFileSync(file, 'utf8');
  const strings = [];
  for (const m of src.matchAll(CLASS_STRING)) strings.push(m[1]);
  for (const m of src.matchAll(EXTRA_STRINGS)) strings.push(m[1]);
  for (const s of strings) {
    for (const token of tokensIn(s)) {
      const root = token.split('-')[0];
      if (known.has(token) || known.has(root)) continue;
      if (!offenders.has(token)) offenders.set(token, file);
    }
  }
}

if (offenders.size > 0) {
  console.error('Colour utilities referencing tokens that are not in tailwind.config:\n');
  for (const [token, file] of offenders) console.error(`  ${token}  (first seen in ${file})`);
  console.error('\nTailwind emits nothing for an unknown colour, so these render transparent or');
  console.error('inherit. Add the key to tailwind.config.ts, or remove the class.');
  process.exit(1);
}

console.log(`All colour utilities resolve to a defined token (${known.size} known).`);
