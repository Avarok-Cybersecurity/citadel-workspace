/**
 * A file must not sit beside a directory of the same name.
 *
 * `src/components/ui/sidebar.tsx` (764 lines) and `src/components/ui/sidebar/`
 * (549 lines across five files) both existed. Module resolution prefers the
 * file, so every `@/components/ui/sidebar` import in the app meant the
 * monolith, and the tidy split version had **zero importers**. It was also an
 * incomplete copy — missing SidebarTrigger, SidebarMenuSkeleton and the three
 * MenuSub components — so nothing could have imported it successfully anyway.
 *
 * The cost is not the dead bytes. It is that people read it and believed it:
 * `tree-helpers.ts` had a comment explaining that its locator was deliberately
 * broad because "there are two SidebarMenuButton implementations in the tree,
 * so pinning to the attribute makes the helper depend on which one a given node
 * happens to use". There were two. Only one ran. A weaker test was adopted to
 * hedge against a fork that did not exist in the shipped app, and the false
 * reason written beside it is what stopped the question being asked again.
 *
 * Anyone splitting a large file this way will produce exactly this shape and
 * see no error: the build passes, the tests pass, and the new code is never
 * loaded.
 *
 * A shadowed directory is only DEAD when nothing reaches into it by a deeper
 * path either. `src/lib/utils.ts` shadows `src/lib/utils/`, and that directory
 * has 55 deep importers — `@/lib/utils/cid-utils` and friends resolve fine.
 * Only the bare specifier is ambiguous there, which is a naming smell and not a
 * defect. The check is therefore about unreachable code, not about the
 * collision.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import fg from 'fast-glob';
import { stripComments } from '@/test-utils/strip-comments';

const SRC: string = join(process.cwd(), 'src');
const CODE: readonly string[] = ['.ts', '.tsx'];

/** Anything importing this directory by a path deeper than its name. */
function hasDeepImporters(sources: readonly string[], directory: string): boolean {
  const needle: string = `${directory}/`;
  return sources.some((source) => source.includes(needle));
}

function shadowedIn(dir: string, out: string[], sources: readonly string[]): void {
  const entries: string[] = readdirSync(dir);
  const directories: Set<string> = new Set(
    entries.filter((e) => statSync(join(dir, e)).isDirectory()),
  );

  for (const entry of entries) {
    const full: string = join(dir, entry);
    if (directories.has(entry)) {
      shadowedIn(full, out, sources);
      continue;
    }
    const extension: string | undefined = CODE.find((ext) => entry.endsWith(ext));
    if (!extension) continue;
    const base: string = entry.slice(0, -extension.length);
    if (!directories.has(base)) continue;
    const relative: string = join(dir, base).replace(`${SRC}/`, '');
    if (hasDeepImporters(sources, relative)) continue;
    out.push(`${full.replace(SRC, 'src')} shadows ${base}/, which nothing imports`);
  }
}

describe('a module directory', () => {
  it('is not shadowed by a file of the same name and left unreachable', async () => {
    // Comments stripped, and this file excluded. The gate in round 246 flagged
    // ITSELF by reading a path out of its own doc comment; a check that counts
    // prose as evidence will find whatever it happens to describe.
    const files: string[] = await fg(['**/*.ts', '**/*.tsx'], { cwd: SRC, absolute: true });
    const sources: string[] = files
      .filter((file) => !file.endsWith('no-module-is-shadowed-by-a-file.test.ts'))
      .map((file) => stripComments(readFileSync(file, 'utf-8')));

    const shadowed: string[] = [];
    shadowedIn(SRC, shadowed, sources);

    expect(
      shadowed,
      'the file wins in module resolution and nothing reaches past it, so the ' +
        'directory is dead code that still reads as live. Delete one, or make ' +
        'the file re-export the directory.',
    ).toEqual([]);
  });
});
