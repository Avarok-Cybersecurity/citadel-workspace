/**
 * Citadel Docs costs nothing until a document opens. Walks the STATIC import graph from
 * src/main.tsx (type-only imports are erased, dynamic import() is the point, so neither is an
 * edge) and fails if it reaches any cdoc module, the page view, or the generated glue. The
 * only doors are lib/cdoc/runtime-loader.ts (a dynamic import) and documents/DocsCanvas.tsx
 * (React.lazy in DocumentHost); types-only document-source.ts is allowed.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { SRC, chain, graphFrom as graphOf, staticImports } from './import-graph';

const ALLOWED: ReadonlySet<string> = new Set<string>(['lib/cdoc/runtime-loader.ts', 'lib/cdoc/document-source.ts']);
const FORBIDDEN: readonly RegExp[] = [/^lib\/cdoc\//, /^\.\.\/vendor\/cdoc\//, /^components\/documents\/(PageView|DocsCanvas)\.tsx$/, /^components\/documents\/page-view\//];

const graphFrom = (entry: string): Map<string, string> => graphOf(entry, staticImports);

const eagerIn = (graph: Map<string, string>): string[] =>
  [...graph.keys()]
    .map((f: string) => relative(SRC, f))
    .filter((f: string) => !ALLOWED.has(f) && FORBIDDEN.some((re: RegExp) => re.test(f)))
    .map((f: string) => chain(graph, join(SRC, f)));

describe('Citadel Docs is loaded lazily', () => {
  const fromMain: Map<string, string> = graphFrom(join(SRC, 'main.tsx'));
  // DocumentHost is itself behind a lazy route; walking from it too means cdoc stays out of
  // even the chunk that shows a document, until the Docs editor region mounts.
  const fromHost: Map<string, string> = graphFrom(join(SRC, 'components/documents/DocumentHost.tsx'));

  // The file manager opens Docs files in place; it must reach cdoc only through the same doors.
  const fromFileManager: Map<string, string> = graphFrom(join(SRC, 'components/file-manager/FileManagerContent.tsx'));

  it('walks real graphs', () => {
    expect(fromMain.size).toBeGreaterThan(200);
    expect([...fromHost.keys()].map((f: string) => relative(SRC, f))).toContain('lib/citadel-apps/registry.ts');
  });

  it('reaches no cdoc module, page view or glue statically from main.tsx', () => {
    expect(eagerIn(fromMain)).toEqual([]);
  });

  it('reaches none from DocumentHost either: DocsCanvas arrives through React.lazy', () => {
    expect(eagerIn(fromHost)).toEqual([]);
    expect(readFileSync(join(SRC, 'components/documents/DocumentHost.tsx'), 'utf8')).toMatch(/lazy\(\(\) => import\('\.\/DocsCanvas'\)\)/);
  });

  it('reaches none from the file manager, which opens Docs files through DocumentHost', () => {
    expect([...fromFileManager.keys()].map((f: string) => relative(SRC, f))).toContain('components/file-manager/DocsFileScreen.tsx');
    expect(eagerIn(fromFileManager)).toEqual([]);
  });

  it('reads type-only imports as erased and value imports as edges', () => {
    expect(staticImports("import type { A } from './a';\nimport { B } from './b';\nexport { C } from './c';")).toEqual(['./b', './c']);
  });
});
