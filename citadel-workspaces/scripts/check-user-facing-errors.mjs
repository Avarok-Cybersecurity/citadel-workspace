/**
 * A user is never shown a raw thrown value.
 *
 * `toast.error(`Failed to delete: ${err}`)` reads as ordinary defensive code
 * and produces one of three things depending on what was thrown:
 *
 *   new Error('timed out')  ->  "Failed to delete: Error: timed out"
 *   { code: 5 }             ->  "Failed to delete: [object Object]"
 *   'timed out'             ->  "Failed to delete: timed out"
 *
 * The middle one is the defect. The revfs and websocket layers both reject
 * with structured payloads, so `[object Object]` is not hypothetical — it is
 * what a user gets, with nothing in it to search for, report or act on.
 *
 * It was in one file eight times, written three different ways, plus a system
 * notification and a rethrow elsewhere. `describeError` renders any of them,
 * and never returns `[object Object]`.
 *
 * Only the surfaces a person reads: toasts and notifications. A `debugLog` or
 * a `console.error` interpolating a raw value is fine — better than fine, the
 * structure is what a developer wants there.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve } from 'node:path';

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(APP, 'src');

/** `toast.error(...)`, `toastError(...)`, `addSystemNotification(...)`, … */
const USER_FACING = /\b(?:toast\s*\.\s*\w+|toastError|toastSuccess|add\w*Notification)\s*\(/;
/** A bare `${err}` / `${error}` / `${e}` — not `${describeError(err)}`. */
const RAW_VALUE = /\$\{\s*(?:err|error|e)\s*\}/;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '__tests__') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const offenders = [];
for (const file of walk(SRC)) {
  const lines = readFileSync(file, 'utf-8').split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    // Same line, so a multi-line call is missed. That is deliberate: the
    // alternative is parsing, and a gate that is occasionally silent beats one
    // that is occasionally wrong.
    // Comment lines are prose, and this file's own docstring quotes the
    // very pattern it forbids — a gate that flags the explanation of itself
    // teaches the reader to ignore it.
    const code = lines[i].trim();
    if (code.startsWith('*') || code.startsWith('//') || code.startsWith('/*')) continue;
    if (USER_FACING.test(lines[i]) && RAW_VALUE.test(lines[i])) {
      offenders.push([relative(APP, file), i + 1, lines[i].trim().slice(0, 110)]);
    }
  }
}

if (offenders.length > 0) {
  console.error('\n  A raw thrown value is being shown to a user:\n');
  for (const [file, line, text] of offenders) {
    console.error(`::error file=citadel-workspaces/${file},line=${line}::${text}`);
  }
  console.error(
    '\n  Use describeError() from @/lib/describe-error. Interpolating the value\n' +
    '  directly gives "[object Object]" for anything rejected with a structured\n' +
    '  payload, which the revfs and websocket layers both do.\n',
  );
  process.exit(1);
}

console.log('  User-facing errors: no raw thrown values in a toast or notification  ok');
