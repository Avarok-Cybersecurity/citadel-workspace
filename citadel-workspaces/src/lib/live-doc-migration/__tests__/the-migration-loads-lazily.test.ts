// @vitest-environment node
/**
 * The chat-document migration costs nothing until it runs: no page reaches it, or the loss
 * banner, through a static import. The one door from the app is the dynamic import in
 * hooks/use-live-doc-migration-sweep.ts, which the signed-in layout runs after first paint.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { SRC, graphFrom, staticImports } from '@/lib/cdoc/__tests__/import-graph';

const MIGRATION: RegExp = /^(lib\/live-doc-migration\/|components\/documents\/migration\/)/;

const reached = (entry: string): string[] =>
  [...graphFrom(join(SRC, entry), staticImports).keys()].map((f: string): string => relative(SRC, f)).filter((f: string): boolean => MIGRATION.test(f));

describe('the chat-document migration is loaded lazily', () => {
  it('is reached by no static import from main.tsx, nor from the signed-in layout', () => {
    expect(reached('main.tsx')).toEqual([]);
    expect(reached('components/layout/AppLayout.tsx')).toEqual([]);
  });

  it('control: the walk does see the migration from its own entry, so an empty answer above means something', () => {
    expect(reached('lib/live-doc-migration/boot.ts')).toContain('lib/live-doc-migration/runner.ts');
  });

  it('is started from the layout through a dynamic import', () => {
    expect(readFileSync(join(SRC, 'hooks/use-live-doc-migration-sweep.ts'), 'utf8')).toMatch(/import\('@\/lib\/live-doc-migration\/boot'\)/);
    expect(readFileSync(join(SRC, 'components/layout/AppLayout.tsx'), 'utf8')).toMatch(/useLiveDocMigrationSweep\(\);/);
  });
});
