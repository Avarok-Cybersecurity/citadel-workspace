/**
 * A declared object store must have a reader or a writer.
 *
 * v1 declared six and used two. `sessions`, `messages`, `peers` and `instances`
 * were created in every user's browser and never written to by any commit in
 * the history of this repository — while telling anyone who read the schema
 * that conversations, peer registrations and session records were kept there.
 * They are kept in the internal service's LocalDB.
 *
 * That is the failure this repository keeps meeting from a new angle: a
 * declaration is not an implementation, and nothing had ever compared the two.
 * The store list was also written out twice — once in storage-migrations.ts and
 * once as a hand-copied union in storage-utils.ts — so every place that knew
 * the names knew them independently and none of them could notice.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { STORE_NAMES } from '../storage-migrations';

const SRC: string = resolve(__dirname, '../..');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path: string = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (entry === '__tests__') continue;
      out.push(...sourceFiles(path));
    } else if (/\.tsx?$/.test(entry)) {
      out.push(path);
    }
  }
  return out;
}

describe('every declared IndexedDB store', () => {
  const files: string[] = sourceFiles(SRC).filter(
    (f) => !f.endsWith('storage-migrations.ts') && !f.endsWith('storage-utils.ts'),
  );
  const corpus: string = files.map((f) => readFileSync(f, 'utf8')).join('\n');

  it('reads a corpus, so the rule is not passing over nothing', () => {
    expect(files.length).toBeGreaterThan(100);
    expect(corpus).toContain('dbPut(');
  });

  it('is read or written somewhere', () => {
    const unused: ("keyValue" | "tabContext")[] = STORE_NAMES.filter((name): boolean => {
      // Either a direct call — dbPut('tabContext', …) — or a named constant
      // holding the store, which is how group-persistence refers to keyValue.
      const direct: RegExp = new RegExp(`db(Put|Get|Delete)\\(\\s*['"\`]${name}['"\`]`);
      const viaConst: RegExp = new RegExp(`=\\s*['"\`]${name}['"\`]`);
      return !direct.test(corpus) && !viaConst.test(corpus);
    });

    expect(unused).toEqual([]);
  });
});
