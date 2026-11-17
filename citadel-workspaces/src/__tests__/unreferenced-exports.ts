/**
 * Finding exported functions that nothing anywhere refers to.
 *
 * Shared by the ratchet test and available to run by hand. Deliberately crude —
 * a whole-word text search over `src/`, not a resolver — because the failure it
 * looks for is coarse: a function that no file mentions by name is not being
 * called by any import shape, dynamic or otherwise.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export interface Unreferenced {
  name: string;
  file: string;
}

export interface Scan {
  /** How many exported functions were examined. */
  examined: number;
  unreferenced: Unreferenced[];
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path: string = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (/\.tsx?$/.test(entry)) out.push(path);
  }
  return out;
}

export function scanExports(src: string): Scan {
  const files: string[] = sourceFiles(src);
  const text: Map<string, string> = new Map(files.map((f): [string, string] => [f, readFileSync(f, 'utf8')]));

  const declaredIn: Map<string, string> = new Map<string, string>();
  for (const [file, body] of text) {
    for (const m of body.matchAll(/^export\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)/gm)) {
      if (!declaredIn.has(m[1])) declaredIn.set(m[1], file);
    }
  }

  const unreferenced: Unreferenced[] = [];
  for (const [name, file] of declaredIn) {
    const word: RegExp = new RegExp(`\\b${name}\\b`, 'g');
    let total: number = 0;
    for (const [f, body] of text) {
      total += (body.match(word) ?? []).length;
      // The declaration itself is not a reference.
      if (f === file) total -= 1;
    }
    if (total <= 0) unreferenced.push({ name, file: file.slice(src.length + 1) });
  }

  return {
    examined: declaredIn.size,
    unreferenced: unreferenced.sort((a, b) => a.name.localeCompare(b.name)),
  };
}
