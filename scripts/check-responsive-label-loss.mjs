#!/usr/bin/env node
/**
 * A control's only text may not be hidden by a responsive `hidden` class.
 *
 * `<span className="hidden sm:inline">General</span>` inside a TabsTrigger or a
 * Button is `display: none` below the breakpoint, and `display: none` removes
 * the element from the accessibility tree entirely. The control becomes an
 * icon with no accessible name — on a phone, which is the installed PWA's
 * primary surface.
 *
 * Nothing else catches it. axe runs at desktop width, where the text is
 * visible; jsx-a11y sees a child with text and is satisfied; a screenshot at
 * 375px shows a perfectly reasonable icon.
 *
 * This is the third time it shipped here. OfficeLayout was fixed with
 * `sr-only` (which keeps the element in the tree) and SettingsModal with
 * `aria-label`, both with comments explaining why — and AdminModal and
 * ChatSettingsPanel were written afterwards without either. So the fix is a
 * guard on the mechanism rather than a fourth instance-level repair.
 *
 * Either remedy passes: `aria-label` on the control, or `sr-only` instead of
 * `hidden` on the text.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'citadel-workspaces/src';

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (full.endsWith('.tsx')) yield full;
  }
}

// Elements that are controls: they need a name. A `hidden sm:inline` span inside
// a plain layout div is fine — it is decoration, not a control's only label.
const CONTROL = /^(Button|TabsTrigger|ToggleGroupItem|MenubarTrigger|button|a)$/;
const offenders = [];

for (const file of walk(ROOT)) {
  const src = readFileSync(file, 'utf8');
  // Walk each opening control tag and take the text up to its matching close.
  const openTag = /<([A-Za-z][A-Za-z0-9]*)\b([^>]*)>/g;
  let m;
  while ((m = openTag.exec(src)) !== null) {
    const [, tag, attrs] = m;
    if (!CONTROL.test(tag)) continue;
    if (attrs.endsWith('/')) continue;
    const close = src.indexOf(`</${tag}>`, m.index);
    if (close === -1) continue;
    const body = src.slice(m.index + m[0].length, close);
    // Nested same-tag controls would make this slice too wide; skip those.
    if (body.includes(`<${tag} `)) continue;

    const hiddenText = /className="[^"]*\bhidden\b[^"]*"[^>]*>\s*\{?\s*[A-Za-z]/.test(body)
      || /className=\{[^}]*'hidden[^}]*\}[^>]*>\s*[A-Za-z]/.test(body);
    if (!hiddenText) continue;

    // Any text that survives the breakpoint, or an explicit name, is enough.
    const hasName = /\baria-label\b|\baria-labelledby\b|\btitle=/.test(attrs)
      || /className="[^"]*\bsr-only\b/.test(body)
      || />\s*[A-Za-z][^<>{}]*</.test(body.replace(/<[^>]*className="[^"]*\bhidden\b[^"]*"[^>]*>[^<]*<\/[^>]+>/g, ''));
    if (hasName) continue;

    const line = src.slice(0, m.index).split('\n').length;
    offenders.push(`${file}:${line}  <${tag}> — its only text is hidden below the breakpoint`);
  }
}

if (offenders.length > 0) {
  console.error('Controls that lose their accessible name at narrow widths:\n');
  for (const o of offenders) console.error(`  ${o}`);
  console.error('\nGive the control an aria-label, or use `sr-only` rather than `hidden`');
  console.error('so the text stays in the accessibility tree. See SettingsModal.tsx.');
  process.exit(1);
}

console.log('No control loses its accessible name at narrow widths.');
