/**
 * wasm-bindgen glue JS and its .wasm binary are coupled through export tables
 * and closure-shim indices. Serve one generation's glue against another's
 * binary and every internal-service call silently no-ops — login and register
 * do nothing, with no message and no server-side log line.
 *
 * The glue lives in hashed app chunks, which the precache versions atomically.
 * So the binary's caching decides whether the pair matches, and this repo has
 * now shipped every wrong answer to that question:
 *
 *   CacheFirst              old binary, new glue, for up to thirty days
 *   StaleWhileRevalidate    the very reload applying an update pairs new glue
 *                           with the previous binary
 *   NetworkFirst            with registerType 'prompt', the OLD worker keeps
 *                           serving OLD glue while the network hands it the NEW
 *                           binary — so every launch between a deploy and the
 *                           user clicking Reload runs a mismatched pair, and
 *                           the mismatched binary poisons the cache for offline
 *                           starts too
 *
 * Each fix corrected the previous direction and opened another, because all
 * three answer from a generation independent of the precache. The binary is now
 * precached WITH the glue, so both halves are revisioned by the same worker and
 * there is no window in which a page holds one of each.
 *
 * This reads the real vite config rather than a copy of the rule.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const config: string = readFileSync(join(process.cwd(), 'vite.config.ts'), 'utf8');

/** The config with `//` comments stripped, so prose cannot satisfy a check. */
const code: string = config.replace(/^\s*\/\/.*$/gm, '');

describe('the WASM binary', () => {
  it('is precached, so it is versioned with the glue that calls it', () => {
    const globPatterns: RegExpMatchArray | null = code.match(/globPatterns:\s*\[([^\]]*)\]/);
    expect(globPatterns, 'no globPatterns in the workbox config').not.toBeNull();
    expect(
      globPatterns![1],
      'the binary must be precached — every strategy that answers from a ' +
        'generation independent of the precache splits it from its glue',
    ).toMatch(/wasm/);
  });

  it('is not excluded from the precache', () => {
    const globIgnores: RegExpMatchArray | null = code.match(/globIgnores:\s*\[([^\]]*)\]/);
    expect(globIgnores).not.toBeNull();
    expect(
      globIgnores![1],
      'excluding all .wasm is what made the pair splittable in the first place',
    ).not.toMatch(/\*\*\/\*\.wasm|'\*\.wasm'/);
  });

  it('has no runtime-caching rule racing the precache', () => {
    const runtime: string = code.slice(code.indexOf('runtimeCaching:'));
    const rules: string = runtime.slice(0, runtime.indexOf('devOptions'));
    expect(
      rules,
      'a runtime rule answers from its own generation, which is exactly how ' +
        'the glue and the binary came apart three times',
    ).not.toMatch(/\.wasm/);
  });

  it('fits under the per-file precache cap', () => {
    // A byte count, written as an integer literal (digit separators allowed).
    const cap: RegExpMatchArray | null = code.match(/maximumFileSizeToCacheInBytes:\s*(\d[\d_]*),/);
    expect(cap, 'no maximumFileSizeToCacheInBytes — the binary would be dropped').not.toBeNull();

    const capBytes: number = Number(cap![1].replace(/_/g, ''));

    // The cap has to clear the binary, and workbox drops an over-cap file from
    // the precache SILENTLY — which reinstates the glue/binary split without
    // changing a line of the strategy.
    //
    // public/wasm is build output, not committed: this ran against the real
    // file locally and threw ENOENT in CI, where the WASM has not been built
    // yet. So the floor is asserted unconditionally and the real size only when
    // there is a real file, and the test says which it did rather than quietly
    // becoming a no-op on the machine that matters.
    const FLOOR_BYTES: number = 4 * 1024 * 1024;
    expect(capBytes, 'the cap must clear a WASM binary of several megabytes').toBeGreaterThanOrEqual(
      FLOOR_BYTES,
    );

    // The Citadel Docs binaries are vendored and committed, so their sizes are checked
    // everywhere, CI included, with no existence escape.
    for (const name of ['editor', 'pdf']) {
      expect(
        statSync(join(process.cwd(), `public/cdoc/cdoc_wasm_${name}_bg.wasm`)).size,
        `the Citadel Docs ${name} binary is larger than the precache cap, so workbox will drop it`,
      ).toBeLessThan(capBytes);
    }

    const binary: string = join(process.cwd(), 'public/wasm/citadel_internal_service_wasm_client_bg.wasm');
    if (!existsSync(binary)) return;

    expect(
      readFileSync(binary).byteLength,
      'the built binary is larger than the precache cap, so workbox will drop it',
    ).toBeLessThan(capBytes);
  });
});
