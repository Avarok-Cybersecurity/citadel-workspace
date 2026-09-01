#!/usr/bin/env node
/**
 * No control may be revealed by hover alone.
 *
 * `opacity-0 group-hover:opacity-100` reads as a tasteful fade-in on a desktop
 * and is a functional dead end everywhere else. A touch device has no hover, so
 * the reveal never fires and the control is not hard to find but unreachable —
 * this pattern had taken Edit, Admin Settings and Delete off the node tree and
 * reply/edit/delete off every message for anyone using the installed PWA. It
 * hides them from keyboard users too: focus lands on something with zero
 * opacity and nothing appears to happen.
 *
 * Use the `.reveal-on-hover` utility in index.css instead. It applies the fade
 * only under `(hover: hover) and (pointer: fine)` and restores opacity on
 * `:focus-visible` / `:focus-within`.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'citadel-workspaces/src';

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (full.endsWith('.tsx') || full.endsWith('.ts')) yield full;
  }
}

const offenders = [];
for (const file of walk(ROOT)) {
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    // Same class attribute, or close enough to be one: a multi-line template
    // literal is still checked line by line, so require both tokens within a
    // small window rather than on the exact same line.
    const window = lines.slice(Math.max(0, i - 2), i + 3).join(' ');

    // Every way Tailwind hides a control and reveals it on hover, not just the
    // one spelling this originally looked for.
    //
    // It required the literal `group-hover:opacity-100`, so a NAMED group —
    // `group-hover/menu-item:opacity-100 … md:opacity-0`, which is exactly what
    // ui/sidebar.tsx uses — sailed straight through, as would
    // `invisible group-hover:visible` or `hidden group-hover:flex`. The check
    // could not fail for whole families of the defect it exists to catch.
    //
    // `md:` and friends count as hiding: a control hidden only at desktop
    // widths is still hidden on a desktop, and hover is the only way back.
    const HIDDEN_THEN_REVEALED = [
      [/(?:^|[\s"'`:])(?:[a-z]+:)?opacity-0\b/, /group-hover(?:\/[\w-]+)?:opacity-(?:100|[1-9]\d)/],
      [/(?:^|[\s"'`:])(?:[a-z]+:)?invisible\b/, /group-hover(?:\/[\w-]+)?:visible/],
      [/(?:^|[\s"'`:])(?:[a-z]+:)?hidden\b/, /group-hover(?:\/[\w-]+)?:(?:flex|block|grid|inline|inline-flex|inline-block)/],
      [/(?:^|[\s"'`:])(?:[a-z]+:)?scale-0\b/, /group-hover(?:\/[\w-]+)?:scale-(?:100|[1-9]\d)/],
    ];

    // Hiding gated on an actual hover-capable pointer is the correct pattern —
    // the control simply stays visible where hover does not exist. `md:` is NOT
    // this: it uses viewport width as a proxy for pointer type, so a tablet at
    // desktop width hides the control with no way to reveal it.
    if (/\[@media\(hover:hover\)[^\]]*\]:(?:opacity-0|invisible|hidden)/.test(window)) return;

    for (const [hidden, revealed] of HIDDEN_THEN_REVEALED) {
      if (hidden.test(line) && revealed.test(window)) {
        offenders.push(`${file}:${i + 1}`);
        break;
      }
    }
  });
}

// The other half of the contract: the utility those sites depend on has to keep
// its guard. All eight controls share `.reveal-on-hover`, so if the media query
// or the focus rules are edited away, every one of them silently reverts to
// being hover-only — and the check above would still pass, because no file uses
// the forbidden pattern any more. Two integration tests
// (tests-pw/touch-controls.spec.ts) prove the mechanism works in a real browser;
// this makes sure the mechanism still exists.
const css = readFileSync('citadel-workspaces/src/index.css', 'utf8');
const utility = /\.reveal-on-hover[\s\S]*$/.exec(css)?.[0] ?? '';

const required = [
  {
    test: /@media\s*\(hover:\s*hover\)[^{]*\{[\s\S]*?\.reveal-on-hover\s*\{[^}]*opacity:\s*0/,
    why: 'the `opacity: 0` must sit inside `@media (hover: hover)`, or the fade applies on touch devices too and the controls become unreachable again',
  },
  {
    test: /\.reveal-on-hover:focus-visible/,
    why: 'without `:focus-visible` a keyboard user tabs onto an invisible control',
  },
  {
    test: /\.reveal-on-hover:focus-within/,
    why: 'without `:focus-within` the sites that put the class on a wrapper rather than the button stay hidden when focused',
  },
];

if (!/\.reveal-on-hover\s*\{/.test(css)) {
  offenders.push('citadel-workspaces/src/index.css: the .reveal-on-hover utility is missing entirely');
} else {
  for (const { test, why } of required) {
    if (!test.test(css)) {
      offenders.push(`citadel-workspaces/src/index.css: .reveal-on-hover — ${why}`);
    }
  }
}
void utility;

const unique = [...new Set(offenders)];
if (unique.length > 0) {
  console.error('Controls revealed by hover alone (unreachable on touch, invisible to keyboard focus):\n');
  for (const o of unique) console.error(`  - ${o}`);
  console.error('\nUse the .reveal-on-hover utility from src/index.css instead.');
  process.exit(1);
}

console.log('No hover-only controls: every fade-in also responds to touch and focus.');
