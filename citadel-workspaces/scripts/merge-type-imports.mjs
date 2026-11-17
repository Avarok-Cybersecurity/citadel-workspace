/**
 * Fold `import type { X } from 'y'` into an existing import from the same module.
 *
 * The annotator adds one import line per name it had to bring in. That is
 * correct and it is also a line, and six files crossed the 250-line ceiling on
 * lines that added no meaning -- a second import from a module the file already
 * imports from.
 *
 * TypeScript's inline `type` modifier says the same thing in the import that is
 * already there: `import { foo, type X } from 'y'`.
 *
 * And where there is no such import to fold into, several type-only imports
 * from the SAME module become one. Eight files were still over the ceiling on
 * four and five separate lines naming the same module.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(APP, 'src');

function files(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...files(path));
    else if (/\.tsx?$/.test(entry)) out.push(path);
  }
  return out;
}

let merged = 0;
let touched = 0;

for (const file of files(SRC)) {
  const text = readFileSync(file, 'utf-8');
  const lines = text.split('\n');
  const drop = new Set();
  let changed = false;

  lines.forEach((line, index) => {
    // Either quote style. The first version matched only single quotes, and
    // this file uses double ones -- so three type imports it could have folded
    // stayed as three lines and pushed the file over the ceiling.
    const typeOnly = line.match(/^import type \{ ([A-Za-z_$][\w$]*) \} from ['"]([^'"]+)['"];$/);
    if (!typeOnly) return;
    const [, name, module] = typeOnly;

    // A named import from the same module, on one line, that is not itself a
    // type-only import (folding into one of those would be a no-op).
    const host = lines.findIndex(
      (other, otherIndex) =>
        otherIndex !== index &&
        new RegExp(`^import (?:type )?\\{ [^}]*\\} from ['"]${module.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}['"];$`).test(other),
    );
    if (host < 0) return;
    // Only when this module has exactly ONE type-only line. Folding two of them
    // into the same value import lost a name -- `RevfsFileMetadata` vanished
    // and the file stopped compiling. Several lines from one module are the
    // grouping pass's job, below.
    const sameModule = lines.filter((other) =>
      new RegExp(`^import type \\{ [^}]+ \\} from ['"]${module.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"];$`).test(other),
    );
    if (sameModule.length !== 1) return;
    if (new RegExp(`\\b${name}\\b`).test(lines[host])) { drop.add(index); changed = true; return; }

    lines[host] = lines[host].replace(/\} from (['"])/, `, type ${name} } from $1`);
    drop.add(index);
    merged += 1;
    changed = true;
  });

  // Group whatever type-only imports remain, by module.
  const kept = lines.filter((_, index) => !drop.has(index));
  const byModule = new Map();
  kept.forEach((line, index) => {
    const match = line.match(/^import type \{ ([^}]+) \} from ['"]([^'"]+)['"];$/);
    if (!match) return;
    const [, names, module] = match;
    if (!byModule.has(module)) byModule.set(module, { at: index, names: [], lines: [] });
    const entry = byModule.get(module);
    entry.names.push(...names.split(',').map((n) => n.trim()));
    entry.lines.push(index);
  });
  const removeToo = new Set();
  for (const entry of byModule.values()) {
    if (entry.lines.length < 2) continue;
    const unique = [...new Set(entry.names)];
    kept[entry.at] = kept[entry.at].replace(/\{ [^}]+ \}/, `{ ${unique.join(', ')} }`);
    for (const line of entry.lines.slice(1)) removeToo.add(line);
    merged += entry.lines.length - 1;
    changed = true;
  }

  if (!changed) continue;
  touched += 1;
  writeFileSync(file, kept.filter((_, index) => !removeToo.has(index)).join('\n'));
}

console.log(`  Merged ${merged} type import(s) into existing ones, across ${touched} file(s).`);
