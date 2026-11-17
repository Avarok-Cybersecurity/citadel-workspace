/**
 * A window whose chunks were replaced underneath it must recover on its own.
 *
 * `skipWaiting` takes over EVERY client at once, so the moment one window
 * accepts an update the new precache is active everywhere — and the old hashed
 * chunks are gone from it and 404 from nginx, which serves only the current
 * build. Every route in this app is lazy, so any other open window that then
 * navigates somewhere it had not already visited fails its dynamic import.
 *
 * With nothing listening, that rejection reaches the top-level error boundary
 * and replaces the whole app, for a user who did nothing but have a second tab
 * open. Multi-tab is first-class here — the leader/follower architecture assumes
 * it.
 *
 * Asserted on the source, because the handler is registered at module scope in
 * the app's entry point, which cannot be imported in a test without booting the
 * whole application.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** main.tsx with comments stripped — a source assertion must read code. */
const main: string = readFileSync(join(process.cwd(), 'src/main.tsx'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .filter((line) => !line.trim().startsWith('//'))
  .join('\n');

const handler: string = main.slice(main.indexOf("'vite:preloadError'"));

describe('a superseded build', () => {
  it('is recovered from, rather than reaching the error boundary', () => {
    expect(main).toMatch(/addEventListener\(\s*'vite:preloadError'/);
  });

  it('reloads, because the new build is already the one installed', () => {
    expect(handler).toMatch(/location\.reload\(\)/);
  });

  it('stops the rejection so the boundary does not also fire', () => {
    expect(handler).toMatch(/preventDefault\(\)/);
  });
});
