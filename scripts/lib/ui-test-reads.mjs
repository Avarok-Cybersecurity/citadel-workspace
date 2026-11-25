/**
 * The parent paths the UI's unit tests read (pure).
 *
 * vitest runs in citadel-workspaces/, so "unit tests" was selected only by changes there. Tests also
 * read the contracts, the billing catalogue and the agent tree beside it, three ways:
 *   resolve(__dirname, '../../../../../billing/tiers.json')         from the test file
 *   resolve(process.cwd(), '../docs/contracts/batch-1116/fixtures')  from citadel-workspaces/
 *   join(resolve(process.cwd(), '..'), 'docs/contracts/batch-1116')  from the repository root
 * Every string literal in a test is tried all three ways; a candidate counts when it names a path that
 * exists outside citadel-workspaces/. Reading more than a test needs only selects it more often.
 */
import { posix } from 'node:path';

const LITERAL = /'([^'\n]+)'|"([^"\n]+)"|`([^`$\n]+)`/g;

/**
 * @param {{ files: {path: string, source: string}[], ui: string, exists: (path: string) => boolean }} input
 *   paths are repository-relative with '/' separators; `exists` answers for repository-relative paths
 * @returns {string[]} sorted, with any path inside another dropped
 */
export function uiTestReads({ files, ui, exists }) {
  const found = new Set();
  const outside = (p) => p !== '' && !p.startsWith('..') && p !== ui && !p.startsWith(`${ui}/`);
  for (const { path, source } of files) {
    const dir = posix.dirname(path);
    for (const m of source.matchAll(LITERAL)) {
      const literal = (m[1] ?? m[2] ?? m[3]).replace(/\/+$/, '');
      if (!literal.includes('/') || /^[a-z]+:/i.test(literal) || literal.startsWith('/')) continue;
      const candidates = literal.startsWith('../')
        ? [posix.normalize(posix.join(dir, literal)), posix.normalize(posix.join(ui, literal))]
        : [posix.normalize(literal)];
      for (const c of candidates) if (outside(c) && exists(c)) found.add(c);
    }
  }
  const sorted = [...found].sort();
  return sorted.filter((p) => !sorted.some((q) => q !== p && p.startsWith(`${q}/`)));
}

/** Whether a changed path is one of `reads` or inside one. */
export function readsPath(reads, path) {
  return reads.some((r) => path === r || path.startsWith(`${r}/`));
}
