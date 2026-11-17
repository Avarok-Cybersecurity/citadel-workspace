/**
 * The dev server's config must load where it runs.
 *
 * The UI dev container does not get the repository: it bind-mounts `src/`, `public/`, `index.html`,
 * `vite.config.ts` and a few config files one by one (the parent's docker-compose.yml `ui` service).
 * `vite.config.ts` imported `./scripts/lib/service-chunks`, which exists in a checkout and not in
 * that container, so Vite failed to load its config and exited -- a restart loop (10 restarts,
 * exit 1) that every integration and Playwright job then reported only as "Services did not become
 * alive" (UI PR #60). Everything the config imports relatively must live under `src/`.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT: string = resolve(__dirname, '../../..');

function relativeImports(source: string): string[] {
  return [...source.matchAll(/^\s*import[^'"]*['"](\.{1,2}\/[^'"]+)['"]/gm)].map((m: RegExpMatchArray) => m[1]);
}

describe('vite.config.ts', () => {
  it('imports nothing the dev container does not mount', () => {
    const imports: string[] = relativeImports(readFileSync(resolve(ROOT, 'vite.config.ts'), 'utf8'));
    expect(imports.length).toBeGreaterThan(0); // the guard read real imports, not an empty list
    expect(imports.filter((path: string) => !path.startsWith('./src/'))).toEqual([]);
  });
});
