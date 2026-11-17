/**
 * The real cdoc-wasm, for tests: the vendored glues and binaries (editor and PDF artefacts),
 * initialised from the files rather than fetched, and the vendored faces and hyphenation
 * patterns read from public/ (checked against their manifests' sha256 exactly as the browser
 * adapters check them).
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as glue from '../../../../vendor/cdoc/cdoc_wasm_editor.js';
import * as pdfGlue from '../../../../vendor/cdoc/cdoc_wasm_pdf.js';
import { FONT_MANIFEST } from '../generated/font-manifest';
import { PATTERN_MANIFEST } from '../generated/pattern-manifest';
import { CdocEngine } from '../engine/cdoc-engine';
import { EngineAssets } from '../engine/engine-assets';
import { PdfWriter } from '../engine/pdf-writer';
import type { CdocWasm, PdfWasm } from '../engine/cdoc-wasm-api';
import type { FontFaceEntry, FontSource } from '../fonts/font-manifest';
import type { PatternEntry, PatternSource } from '../fonts/pattern-manifest';
import { CdocHost } from '../worker/cdoc-host';
import { RASTERIZER_OPTIONS } from '../paint/paint-config';
import type { CanvasPort, PaintTarget } from '../paint/canvas-port';
import { MainThreadPageRenderer, WorkerPageRenderer, type PageRenderer } from '../paint/page-renderer';
import type { CdocRuntime } from '../runtime';
import { createValueStore, type ValueStore } from '@/lib/value-store';
import type { EngineLoad } from '../worker/engine-load';
import type { EditorOrigin } from '../editor/controller';
import { InProcessCdocClient } from '../worker/clients';
import { recordingContext, recordingPort, recordingTarget, type Recorder, type RecordingPort, type RecordingTarget } from '../paint/__tests__/recording-canvas';
import type { FakeDecoder } from '../paint/__tests__/fake-image-decoder';
import type { Ctx2D } from '../paint/canvas-port';

const UI: string = process.cwd();
let initialised: boolean = false;
let pdfInitialised: boolean = false;

export function realWasm(): CdocWasm {
  if (!initialised) {
    glue.initSync({ module: readFileSync(join(UI, 'public/cdoc/cdoc_wasm_editor_bg.wasm')) });
    initialised = true;
  }
  return glue;
}

export function realPdfWasm(): PdfWasm {
  if (!pdfInitialised) {
    pdfGlue.initSync({ module: readFileSync(join(UI, 'public/cdoc/cdoc_wasm_pdf_bg.wasm')) });
    pdfInitialised = true;
  }
  return pdfGlue;
}

function pinnedFile(dir: string, file: string, sha256: string): Buffer {
  const bytes: Buffer = readFileSync(join(UI, 'public', dir, file));
  if (createHash('sha256').update(bytes).digest('hex') !== sha256) throw new Error(`${file}: sha256 mismatch`);
  return bytes;
}

export const fileFontSource: FontSource = {
  load: (face: FontFaceEntry): Promise<Uint8Array> => Promise.resolve().then(() => new Uint8Array(pinnedFile('fonts/cdoc', face.file, face.sha256))),
};

export const filePatternSource: PatternSource = {
  load: (entry: PatternEntry): Promise<string> => Promise.resolve().then(() => pinnedFile('cdoc/patterns', entry.file, entry.sha256).toString('utf8')),
};

export const fileAssets = (): EngineAssets => new EngineAssets(FONT_MANIFEST, fileFontSource, PATTERN_MANIFEST, filePatternSource);

/** The engine as the worker builds it; `loadPdf` stands in for the PDF artefact's loader. */
export function realEngine(loadPdf: () => Promise<PdfWasm> = (): Promise<PdfWasm> => Promise.resolve(realPdfWasm())): CdocEngine {
  const assets: EngineAssets = fileAssets();
  return new CdocEngine(realWasm(), assets, new PdfWriter(loadPdf, assets));
}

export function realHost(port: CanvasPort, target: (canvas: OffscreenCanvas) => PaintTarget): CdocHost {
  return new CdocHost({ engine: (): Promise<CdocEngine> => Promise.resolve(realEngine()), port, rasterizer: RASTERIZER_OPTIONS, target });
}

/** A replica's snapshot of a document hyphenated automatically, in `language` when given. */
export function hyphenated(language: string | null, text: string): EditorOrigin {
  realWasm();
  const model: { meta: Record<string, unknown>; settings: Record<string, unknown> } = JSON.parse(glue.blank_model_json()) as { meta: Record<string, unknown>; settings: Record<string, unknown> };
  model.settings.autoHyphenation = true;
  if (language !== null) model.meta.language = language;
  const pm: PmDoc = JSON.parse(glue.model_to_pm(JSON.stringify(model))) as PmDoc;
  pm.content[0].content[0].content = [{ type: 'text', text }];
  const migrated: glue.Migrated = glue.pm_to_crdt_snapshot(JSON.stringify(pm), 3n);
  try {
    return { kind: 'snapshot', snapshot: migrated.snapshot() };
  } finally {
    migrated.free();
  }
}

interface PmParagraph { type: string; attrs?: unknown; content?: unknown[] }
interface PmDoc { content: Array<{ content: PmParagraph[] }> }

/** A blank document whose body is `paragraphs` paragraphs, each holding `text`. */
export function pmWithParagraphs(paragraphs: number, text: string): string {
  const doc: PmDoc = JSON.parse(realWasm().blank_pm_json()) as PmDoc;
  const template: PmParagraph = doc.content[0].content[0];
  doc.content[0].content = Array.from({ length: paragraphs }, (): PmParagraph => ({ ...template, content: [{ type: 'text', text }] }));
  return JSON.stringify(doc);
}

/** A blank document whose one paragraph holds `text`. */
export function pmWithText(text: string): string {
  return pmWithParagraphs(1, text);
}

export interface TestRuntime extends CdocRuntime {
  /** Every page canvas the runtime painted, in mount order, with its recorded calls. */
  readonly painted: RecordingTarget[];
  /** Each overlay canvas's recorded context, created on its first paint. */
  readonly overlays: Map<HTMLCanvasElement, Recorder>;
  /** The decodes of the renderer that paints (the host's in worker mode, the page's otherwise). */
  readonly images: FakeDecoder;
}

/**
 * The production runtime minus the thread hop and the canvas: InProcessCdocClient over the real
 * host and wasm, and either renderer, painting into recording targets.
 */
export function inProcessRuntime(renderer: 'worker' | 'main-thread'): TestRuntime {
  const painted: RecordingTarget[] = [];
  const record = (): RecordingTarget => {
    const t: RecordingTarget = recordingTarget();
    painted.push(t);
    return t;
  };
  const hostPort: RecordingPort = recordingPort();
  const pagePort: RecordingPort = recordingPort();
  const client: InProcessCdocClient = new InProcessCdocClient(realHost(hostPort.port, record));
  const pages: PageRenderer = renderer === 'worker'
    ? new WorkerPageRenderer(client, (): OffscreenCanvas => ({}) as OffscreenCanvas)
    : new MainThreadPageRenderer(client, pagePort.port, RASTERIZER_OPTIONS, record);
  const overlays: Map<HTMLCanvasElement, Recorder> = new Map<HTMLCanvasElement, Recorder>();
  const overlayContext = (canvas: HTMLCanvasElement): Ctx2D => {
    let rec: Recorder | undefined = overlays.get(canvas);
    if (rec === undefined) overlays.set(canvas, (rec = recordingContext(canvas.dataset.layer ?? 'overlay')));
    return rec.ctx;
  };
  // In process there is no worker download to report: the engine reads as ready from the start.
  const engineLoad: ValueStore<EngineLoad> = createValueStore<EngineLoad>('test-engine-load', { kind: 'ready' });
  return { client, renderer: pages, painted, overlays, overlayContext, engineLoad, images: (renderer === 'worker' ? hostPort : pagePort).images };
}
