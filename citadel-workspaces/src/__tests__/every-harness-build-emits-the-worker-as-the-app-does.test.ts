/**
 * Every script that builds app code with Vite takes the app's worker settings from
 * vite.config.ts. The Citadel Docs worker loads its wasm glue with a dynamic import, which
 * only an ES module worker can hold; a build that leaves `worker` unset gets Vite's IIFE
 * default and fails as soon as any screen it serves reaches Citadel Docs. The polish harness
 * did, once sharing a document (which sends its held edits) reached the document sync.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const LIB: string = join(process.cwd(), 'scripts', 'lib');

/** Each scripts/lib/<harness>/*.mjs that calls Vite's build(). */
function viteBuilds(): string[] {
  return readdirSync(LIB, { withFileTypes: true }).filter((d) => d.isDirectory()).flatMap((d): string[] =>
    readdirSync(join(LIB, d.name)).filter((f: string): boolean => f.endsWith('.mjs')).map((f: string): string => join(d.name, f))
      .filter((rel: string): boolean => {
        const source: string = readFileSync(join(LIB, rel), 'utf8');
        return /from 'vite'/.test(source) && /\bbuild\(/.test(source);
      }));
}

describe('harness builds', () => {
  it('include the polish, docs and bench harnesses', () => {
    expect(viteBuilds()).toEqual(expect.arrayContaining(['polish-harness/serve.mjs', 'docs-harness/serve.mjs', 'bench-harness/serve.mjs']));
  });

  it.each(viteBuilds())('%s emits the cdoc worker with the app\'s worker settings', (rel: string) => {
    const source: string = readFileSync(join(LIB, rel), 'utf8');
    expect(source).toMatch(/loadConfigFromFile\([^)]*vite\.config\.ts/s);
    expect(source).toMatch(/worker:\s*app\.config\.worker/);
  });
});
