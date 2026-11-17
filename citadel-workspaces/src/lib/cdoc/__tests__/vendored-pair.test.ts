/**
 * The vendored cdoc-wasm is one fresh set. scripts/sync-cdoc-wasm.sh writes both artefacts
 * (editor and PDF: binary, glue, declarations), the hyphenation patterns and PROVENANCE.json in
 * one run; a file changed by anything else (a hand copy, a merge that took one side, a stale
 * rebuild) no longer matches the hashes recorded beside it, and a glue from one build against a
 * binary from another fails at instantiation or calls the wrong export. Each glue must also load
 * its binary from its stable URL.
 */
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { CDOC_EDITOR_WASM_URL, CDOC_FONT_BASE_URL, CDOC_PATTERN_BASE_URL, CDOC_PDF_WASM_URL } from '../asset-urls';
import { FONT_MANIFEST } from '../generated/font-manifest';
import { PATTERN_MANIFEST } from '../generated/pattern-manifest';
import type { PatternEntry } from '../fonts/pattern-manifest';

const UI: string = process.cwd();
const GENERATED: string = join(UI, 'vendor/cdoc');
const sha256 = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex');
const publicPath = (url: string): string => join(UI, 'public', url);

interface Artefact {
  wasm_sha256: string;
  wasm_bytes: number;
  glue_sha256: string;
  dts_sha256: string;
}
interface Provenance {
  citadel_docs_commit: string;
  wasm_bindgen_version: string;
  wasm_opt_version: string;
  artefacts: Record<string, Artefact>;
}
const provenance: Provenance = JSON.parse(readFileSync(join(GENERATED, 'PROVENANCE.json'), 'utf8')) as Provenance;

const ARTEFACTS: readonly (readonly [name: string, url: string])[] = [['editor', CDOC_EDITOR_WASM_URL], ['pdf', CDOC_PDF_WASM_URL]];

describe('the vendored cdoc-wasm set', () => {
  it('names the citadel-docs commit and tool versions it was built with', () => {
    expect(provenance.citadel_docs_commit).toMatch(/^[0-9a-f]{40}$/);
    expect(provenance.wasm_bindgen_version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(provenance.wasm_opt_version).toMatch(/^\d+$/);
  });

  it('records exactly the artefacts the UI loads', () => {
    expect(Object.keys(provenance.artefacts).sort()).toEqual(ARTEFACTS.map(([name]) => name).sort());
  });

  describe.each(ARTEFACTS)('the %s artefact', (name: string, url: string) => {
    const recorded = (): Artefact => provenance.artefacts[name];

    it('has the binary PROVENANCE recorded', () => {
      const binary: string = publicPath(url);
      expect(sha256(binary), 'public/cdoc changed without re-running scripts/sync-cdoc-wasm.sh').toBe(recorded().wasm_sha256);
      expect(statSync(binary).size).toBe(recorded().wasm_bytes);
    });

    it('has the glue and declarations PROVENANCE recorded', () => {
      expect(sha256(join(GENERATED, `cdoc_wasm_${name}.js`)), 'the glue changed without re-running the sync').toBe(recorded().glue_sha256);
      expect(sha256(join(GENERATED, `cdoc_wasm_${name}.d.ts`))).toBe(recorded().dts_sha256);
    });

    it('loads its binary from its stable /cdoc/ URL, never relative to the glue', () => {
      const glue: string = readFileSync(join(GENERATED, `cdoc_wasm_${name}.js`), 'utf8');
      expect(url).toBe(`/cdoc/cdoc_wasm_${name}_bg.wasm`);
      expect(glue).toContain(`module_or_path = ${JSON.stringify(url)};`);
      expect(glue).not.toContain('import.meta.url');
    });
  });

  it('ships no file the sync did not write', () => {
    expect(readdirSync(GENERATED).sort()).toEqual(['PROVENANCE.json', ...ARTEFACTS.flatMap(([name]) => [`cdoc_wasm_${name}.d.ts`, `cdoc_wasm_${name}.js`])].sort());
    expect(readdirSync(join(UI, 'public/cdoc')).sort()).toEqual([...ARTEFACTS.map(([name]) => `cdoc_wasm_${name}_bg.wasm`), 'patterns'].sort());
  });
});

describe('the vendored hyphenation patterns', () => {
  it.each(PATTERN_MANIFEST.patterns.map((p: PatternEntry) => [p.tag, p] as const))('%s is the file the manifest pins', (_tag: string, entry: PatternEntry) => {
    expect(sha256(publicPath(`${CDOC_PATTERN_BASE_URL}${entry.file}`))).toBe(entry.sha256);
    expect(entry.license.length).toBeGreaterThan(0);
  });

  it('are exactly the manifest’s files', () => {
    expect(readdirSync(publicPath(CDOC_PATTERN_BASE_URL)).sort()).toEqual(PATTERN_MANIFEST.patterns.map((p: PatternEntry) => p.file).sort());
  });
});

describe('the vendored faces', () => {
  it.each(FONT_MANIFEST.faces.map((f) => [f.file, f.sha256] as const))('%s is the file the manifest pins', (file: string, sha: string) => {
    expect(sha256(publicPath(`${CDOC_FONT_BASE_URL}${file}`))).toBe(sha);
  });

  it('ship with their licence', () => {
    expect(readFileSync(publicPath(`${CDOC_FONT_BASE_URL}${FONT_MANIFEST.licenseFile}`), 'utf8')).toMatch(/SIL OPEN FONT LICENSE/i);
    expect(FONT_MANIFEST.license).toBe('OFL-1.1');
  });
});
