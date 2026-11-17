/**
 * Give a long object return type a name.
 *
 * The annotator wrote what the compiler printed, and for a hook that returns
 * fifteen fields that is a 945-character line. It is explicit, it is correct,
 * and nobody can read it — which is most of what an explicit type was for.
 *
 * A person writing this by hand writes an interface above the function and
 * names it after the function. So does this: `useGroupChat` gets
 * `UseGroupChatResult`, one field per line, and the signature ends up shorter
 * than it was before any of this started.
 *
 * Only object type literals, only where they are long, and the compiler
 * confirms each one before the next is attempted.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MIN_LENGTH = 160;
const LIMIT = Number(process.argv[2] ?? 12);

function files(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...files(path));
    else if (/\.tsx?$/.test(entry)) out.push(path);
  }
  return out;
}

function typechecks() {
  try {
    execFileSync('npx', ['tsc', '-p', 'tsconfig.app.json', '--noEmit'], { cwd: APP, encoding: 'utf-8' });
    return true;
  } catch {
    return false;
  }
}

/** `Foo` from `export function foo(...)`, `UseXResult` style. */
function nameFor(functionName) {
  const base = functionName.charAt(0).toUpperCase() + functionName.slice(1);
  return `${base}Result`;
}

/** Split an object literal body on top-level `;`, so nested types survive. */
function fields(body) {
  const out = [];
  let depth = 0;
  let current = '';
  for (const character of body) {
    if ('<{(['.includes(character)) depth += 1;
    if ('>})]'.includes(character)) depth -= 1;
    if (character === ';' && depth === 0) {
      if (current.trim()) out.push(current.trim());
      current = '';
    } else current += character;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

let named = 0;
for (const file of files(join(APP, 'src'))) {
  if (named >= LIMIT) break;
  const original = readFileSync(file, 'utf-8');
  const lines = original.split('\n');

  for (let index = 0; index < lines.length && named < LIMIT; index += 1) {
    const line = lines[index];
    if (line.length < MIN_LENGTH) continue;
    // Indented declarations too. Anchoring at column zero missed every nested
    // helper, which is where the longest of these live.
    // The return annotation: `): { ... } {` at the end of the line.
    const returns = line.match(/\):\s*(\{.*\})\s*\{$/);
    if (!returns || returns[1].length < MIN_LENGTH) continue;

    // The function's NAME may be several lines up: a multi-line parameter list
    // puts `): { ... } {` on a line of its own, and requiring both on one line
    // missed every one of the long ones -- which is exactly the shape that gets
    // long in the first place.
    let match = null;
    let declaredAt = index;
    for (let up = index; up >= 0 && up > index - 30; up -= 1) {
      match = lines[up].match(/^(\s*)(?:export )?function (\w+)\(/);
      if (match) { declaredAt = up; break; }
    }
    if (!match) continue;

    const typeName = nameFor(match[2]);
    if (original.includes(`interface ${typeName}`)) continue;
    const body = returns[1].slice(1, -1);
    const indent = match[1] ?? '';
    const declaration = [
      `${indent}interface ${typeName} {`,
      ...fields(body).map((f) => `${indent}  ${f};`),
      `${indent}}`,
      '',
    ];

    const next = [...lines];
    next[index] = line.replace(/\):\s*\{.*\}\s*\{$/, `): ${typeName} {`);
    // ABOVE THE FUNCTION, not above the annotation. The annotation line is in
    // the middle of a multi-line parameter list, and inserting there put an
    // interface inside the signature -- which does not compile, so every one of
    // them was silently reverted and the tool reported "named 0".
    next.splice(declaredAt, 0, ...declaration);
    writeFileSync(file, next.join('\n'));
    if (typechecks()) {
      named += 1;
      break; // re-read this file from scratch on the next outer pass
    }
    writeFileSync(file, original);
  }
}

console.log(`  Named ${named} long return type(s).`);
