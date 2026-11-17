/**
 * The vendored Calendar glue is one fresh set: scripts/build-calendar-glue.mjs writes the binary,
 * the module, its declarations and PROVENANCE.json in one run, so a file changed by anything else
 * no longer matches the hash recorded beside it. The module loads its binary from its stable URL.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CALENDAR_WASM_URL } from '../asset-urls';

const UI: string = process.cwd();
const VENDOR: string = join(UI, 'vendor/calendar');
const sha256 = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex');

interface Provenance {
  source: string;
  wasm_bindgen_version: string;
  wasm_sha256: string;
  wasm_bytes: number;
  glue_sha256: string;
  dts_sha256: string;
}
const provenance: Provenance = JSON.parse(readFileSync(join(VENDOR, 'PROVENANCE.json'), 'utf8')) as Provenance;

describe('the vendored Calendar glue', () => {
  it('is the binary, module and declarations PROVENANCE recorded', () => {
    const binary: string = join(UI, 'public', CALENDAR_WASM_URL);
    expect(sha256(binary), 'public/calendar changed without re-running scripts/build-calendar-glue.mjs').toBe(provenance.wasm_sha256);
    expect(statSync(binary).size).toBe(provenance.wasm_bytes);
    expect(sha256(join(VENDOR, 'calendar_glue.js'))).toBe(provenance.glue_sha256);
    expect(sha256(join(VENDOR, 'calendar_glue.d.ts'))).toBe(provenance.dts_sha256);
    expect(provenance.source).toBe('apps/first-party/calendar/glue');
  });

  it('loads its binary from its stable URL, never relative to the module', () => {
    const module: string = readFileSync(join(VENDOR, 'calendar_glue.js'), 'utf8');
    expect(module).toContain(`module_or_path = ${JSON.stringify(CALENDAR_WASM_URL)};`);
    expect(module).not.toContain('import.meta.url');
  });

  it('ships no file the build did not write', () => {
    expect(readdirSync(VENDOR).sort()).toEqual(['PROVENANCE.json', 'calendar_glue.d.ts', 'calendar_glue.js']);
    expect(readdirSync(join(UI, 'public/calendar'))).toEqual(['calendar_glue_bg.wasm']);
  });
});
