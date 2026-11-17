/**
 * The faces and hyphenation patterns every cdoc-wasm object is furnished with: fetched once
 * each (faces all together, patterns one language at a time as documents need them) and
 * registered the same way on EditorFonts and on either artefact's RenderAssets, so the editor,
 * the read-only view and the PDF writer lay a document out with one set of assets.
 */
import type { FontFaceEntry, FontManifest, FontSource } from '../fonts/font-manifest';
import type { PatternEntry, PatternManifest, PatternSource } from '../fonts/pattern-manifest';
import type { Furnishable, ImageStore, ImageTarget } from './cdoc-wasm-api';

export type LoadedFace = readonly [FontFaceEntry, Uint8Array];
export type LoadedPatterns = readonly [tag: string, text: string];

/** Registers every image in `images` (a file's, or the ones an editor draws) on `target`. */
export function addImages(target: ImageTarget, images: ImageStore): void {
  for (let i: number = 0; i < images.len(); i++) {
    const [id, mime, bytes] = [images.id(i), images.mime(i), images.bytes(i)];
    if (id === undefined || mime === undefined || bytes === undefined) throw new Error(`image ${i} of ${images.len()} is incomplete`);
    target.addImage(id, mime, bytes);
  }
}

/** Sorted, without repeats: the one spelling of a pattern set, for cache keys and comparisons. */
export function patternSet(tags: readonly string[]): readonly string[] {
  return [...new Set(tags)].sort();
}

function retried<T>(promise: Promise<T>, forget: () => void): Promise<T> {
  promise.catch(forget);
  return promise;
}

export class EngineAssets {
  private faces: Promise<readonly LoadedFace[]> | null = null;
  private readonly patterns: Map<string, Promise<string>> = new Map<string, Promise<string>>();

  constructor(
    readonly fontManifest: FontManifest,
    private readonly fontSource: FontSource,
    private readonly patternManifest: PatternManifest,
    private readonly patternSource: PatternSource,
  ) {}

  /** Every face in the manifest, fetched once and in parallel; a failed fetch is retried next time. */
  loadFaces(): Promise<readonly LoadedFace[]> {
    this.faces ??= retried(
      Promise.all(this.fontManifest.faces.map(async (face: FontFaceEntry): Promise<LoadedFace> => [face, await this.fontSource.load(face)])),
      (): void => { this.faces = null; },
    );
    return this.faces;
  }

  private entry(tag: string): PatternEntry {
    const entry: PatternEntry | undefined = this.patternManifest.patterns.find((p: PatternEntry): boolean => p.tag === tag);
    if (entry === undefined) throw new Error(`cdoc-wasm needs hyphenation patterns tagged ${tag}, which the vendored manifest does not list`);
    return entry;
  }

  /** The text of each pattern file in `tags`, each fetched once for the engine's life. */
  loadPatterns(tags: readonly string[]): Promise<readonly LoadedPatterns[]> {
    return Promise.all(patternSet(tags).map(async (tag: string): Promise<LoadedPatterns> => {
      let text: Promise<string> | undefined = this.patterns.get(tag);
      if (text === undefined) {
        text = retried(this.patternSource.load(this.entry(tag)), (): void => { this.patterns.delete(tag); });
        this.patterns.set(tag, text);
      }
      return [tag, await text];
    }));
  }

  /** Registers the faces, the manifest's aliases and `patterns` on `target`. */
  furnish(target: Furnishable, faces: readonly LoadedFace[], patterns: readonly LoadedPatterns[]): void {
    for (const [face, bytes] of faces) target.addFont(face.family, face.bold, face.italic, bytes);
    for (const [name, family] of Object.entries(this.fontManifest.aliases)) target.aliasFont(name, family);
    for (const [tag, text] of patterns) target.addPatterns(tag, text);
  }
}
