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
    if (/\bopacity-0\b/.test(line) && /group-hover:opacity-100/.test(window)) {
      offenders.push(`${file}:${i + 1}`);
    }
  });
}

const unique = [...new Set(offenders)];
if (unique.length > 0) {
  console.error('Controls revealed by hover alone (unreachable on touch, invisible to keyboard focus):\n');
  for (const o of unique) console.error(`  - ${o}`);
  console.error('\nUse the .reveal-on-hover utility from src/index.css instead.');
  process.exit(1);
}

console.log('No hover-only controls: every fade-in also responds to touch and focus.');
