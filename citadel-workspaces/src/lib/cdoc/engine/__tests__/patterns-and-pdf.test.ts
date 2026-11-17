/**
 * Hyphenation patterns are fetched for exactly the languages a document needs, before it is laid
 * out; the PDF artefact is loaded on the first PDF export and never before; and the PDF is laid
 * out with the same pattern set as the editor. Over the real cdoc-wasm (both artefacts), through
 * the production host, with the asset sources and the PDF loader counted.
 */
import { describe, expect, it } from 'vitest';
import * as glue from '../../../../../vendor/cdoc/cdoc_wasm_editor.js';
import * as pdfGlue from '../../../../../vendor/cdoc/cdoc_wasm_pdf.js';
import { fileFontSource, filePatternSource, hyphenated, realPdfWasm, realWasm } from '../../__tests__/wasm-rig';
import { FONT_MANIFEST } from '../../generated/font-manifest';
import { PATTERN_MANIFEST } from '../../generated/pattern-manifest';
import type { PatternEntry, PatternSource } from '../../fonts/pattern-manifest';
import { CdocEngine } from '../cdoc-engine';
import type { CdocWasm, PdfWasm } from '../cdoc-wasm-api';
import { EngineAssets } from '../engine-assets';
import { PdfWriter } from '../pdf-writer';
import { CdocHost } from '../../worker/cdoc-host';
import { InProcessCdocClient } from '../../worker/clients';
import { RASTERIZER_OPTIONS } from '../../paint/paint-config';
import { recordingPort, recordingTarget } from '../../paint/__tests__/recording-canvas';
import { encodeCommand } from '../../editor/wire/encode-command';
import type { EditorCommand, EditorOrigin } from '../../editor/controller';
import type { EditorResults } from '../../worker/editor-protocol';

interface Counted {
  readonly client: InProcessCdocClient;
  /** Pattern files fetched, by tag. */
  readonly fetched: string[];
  /** Tags registered on EditorFonts, then on the PDF artefact's RenderAssets. */
  readonly sealed: string[];
  readonly pdf: string[];
  /** PDF artefact loads. */
  loads: number;
}

function counted(): Counted {
  realWasm();
  const c: Counted = { client: null as unknown as InProcessCdocClient, fetched: [], sealed: [], pdf: [], loads: 0 };
  class Fonts extends glue.EditorFonts {
    override addPatterns(tag: string, text: string): void {
      c.sealed.push(tag);
      super.addPatterns(tag, text);
    }
  }
  class PdfAssets extends pdfGlue.RenderAssets {
    override addPatterns(tag: string, text: string): void {
      c.pdf.push(tag);
      super.addPatterns(tag, text);
    }
  }
  const wasm: CdocWasm = { ...realWasm(), EditorFonts: Fonts };
  const patterns: PatternSource = { load: (entry: PatternEntry): Promise<string> => { c.fetched.push(entry.tag); return filePatternSource.load(entry); } };
  const assets: EngineAssets = new EngineAssets(FONT_MANIFEST, fileFontSource, PATTERN_MANIFEST, patterns);
  const loadPdf: () => Promise<PdfWasm> = (): Promise<PdfWasm> => {
    c.loads++;
    return Promise.resolve({ ...realPdfWasm(), RenderAssets: PdfAssets });
  };
  const engine: CdocEngine = new CdocEngine(wasm, assets, new PdfWriter(loadPdf, assets));
  const host: CdocHost = new CdocHost({ engine: (): Promise<CdocEngine> => Promise.resolve(engine), port: recordingPort().port, rasterizer: RASTERIZER_OPTIONS, target: recordingTarget });
  return Object.assign(c, { client: new InProcessCdocClient(host) });
}

const GERMAN: string = 'Donaudampfschifffahrtsgesellschaftskapitän und Rechtsschutzversicherungsgesellschaften '.repeat(20);

async function open(c: Counted, from: EditorOrigin): Promise<void> {
  await c.client.request({ kind: 'editorOpen', client: 9n, from });
}

async function run(c: Counted, command: EditorCommand): Promise<void> {
  await c.client.request({ kind: 'apply', record: encodeCommand(command) });
}

describe('hyphenation patterns', () => {
  it('fetches none for a document that needs none', async () => {
    const c: Counted = counted();
    await open(c, { kind: 'blank' });
    await run(c, { name: 'insertText', text: 'plain' });
    expect([c.fetched, c.sealed]).toEqual([[], []]);
  });

  it('fetches exactly the languages a document needs, and seals the editor with them', async () => {
    const c: Counted = counted();
    await open(c, hyphenated('de-DE', GERMAN));
    expect(c.fetched).toEqual(['de-1996']);
    expect(c.sealed).toEqual(['de-1996']);
    expect((await c.client.request({ kind: 'missingPatterns' })).tags).toEqual([]);
  });

  it('names a language an edit introduces that the replica was not opened with', async () => {
    const c: Counted = counted();
    await open(c, hyphenated(null, 'bonjour '.repeat(10)));
    expect(c.fetched).toEqual([]);
    await run(c, { name: 'selectAll' });
    await run(c, { name: 'setRunProperty', patch: { lang: 'fr-FR' } });
    expect((await c.client.request({ kind: 'missingPatterns' })).tags).toEqual(['fr']);
    expect(c.fetched, 'nothing is fetched until the document is reopened').toEqual([]);
  });
});

describe('the PDF artefact', () => {
  it('is never loaded before a PDF is exported, and once after', async () => {
    const c: Counted = counted();
    await open(c, hyphenated('de-DE', GERMAN));
    for (const format of ['txt', 'md', 'docx', 'odt'] as const) await c.client.request({ kind: 'exportAs', target: { format } });
    expect(c.loads).toBe(0);
    const first: EditorResults['exportAs'] = await c.client.request({ kind: 'exportAs', target: { format: 'pdf', nowRfc3339: '2026-10-18T00:00:00Z' } });
    await c.client.request({ kind: 'exportAs', target: { format: 'pdf', nowRfc3339: '2026-10-18T00:00:00Z' } });
    expect(c.loads).toBe(1);
    expect(new TextDecoder().decode(first.bytes.subarray(0, 5))).toBe('%PDF-');
    expect(first.reportJson).toBeNull();
  });

  it('lays the PDF out with the same pattern set as the editor', async () => {
    const c: Counted = counted();
    await open(c, hyphenated('de-DE', GERMAN));
    await c.client.request({ kind: 'exportAs', target: { format: 'pdf', nowRfc3339: '2026-10-18T00:00:00Z' } });
    expect(c.sealed).toEqual(['de-1996']);
    expect(c.pdf).toEqual(c.sealed);
    expect(c.fetched, 'each file is fetched once for both').toEqual(['de-1996']);
  });
});
