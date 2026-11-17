/**
 * PDF export through cdoc-wasm's PDF artefact, which the editor artefact leaves out: loaded on
 * the first PDF written and kept for the engine's life. The editor hands over its document as
 * model JSON and the images it draws; the writer furnishes the PDF artefact's RenderAssets with
 * the same faces, aliases and hyphenation patterns the editor laid the document out with, so the
 * PDF breaks lines where the page view does.
 */
import type { ImageStore, PdfRenderAssets, PdfWasm } from './cdoc-wasm-api';
import { addImages, type EngineAssets, type LoadedFace, type LoadedPatterns } from './engine-assets';

export interface PdfInput {
  readonly modelJson: string;
  /** The images the document draws: EditorHandle.drawnImages, or an imported file's. */
  readonly images: ImageStore;
  /** The pattern set the document was laid out with on screen. */
  readonly patterns: readonly string[];
  /** The time the PDF records. */
  readonly nowRfc3339: string;
}

export class PdfWriter {
  private wasm: Promise<PdfWasm> | null = null;

  constructor(
    private readonly load: () => Promise<PdfWasm>,
    private readonly assets: EngineAssets,
  ) {}

  private artefact(): Promise<PdfWasm> {
    if (this.wasm === null) {
      const loading: Promise<PdfWasm> = this.load();
      loading.catch((): void => { this.wasm = null; });
      this.wasm = loading;
    }
    return this.wasm;
  }

  async write(input: PdfInput): Promise<Uint8Array> {
    const [wasm, faces, patterns] = await Promise.all([this.artefact(), this.assets.loadFaces(), this.assets.loadPatterns(input.patterns)]);
    return this.render(wasm, faces, patterns, input);
  }

  private render(wasm: PdfWasm, faces: readonly LoadedFace[], patterns: readonly LoadedPatterns[], input: PdfInput): Uint8Array {
    const assets: PdfRenderAssets = new wasm.RenderAssets(this.assets.fontManifest.fallback, input.nowRfc3339);
    try {
      this.assets.furnish(assets, faces, patterns);
      addImages(assets, input.images);
      return wasm.pm_to_pdf(wasm.model_to_pm(input.modelJson), assets);
    } finally {
      assets.free();
    }
  }
}
