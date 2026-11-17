/**
 * Decoded images by content id, for the painter: each id is decoded once and drawn from here on
 * every later paint of any page, so a keystroke repaint never decodes. Bounded by an explicit
 * byte budget of decoded pixels (width × height × 4); the least recently drawn are closed and
 * dropped first. A placeholder (an image the canvas does not draw) weighs nothing.
 */

/** A decoded image, as createImageBitmap returns it. */
export interface DecodedImage {
  readonly source: CanvasImageSource;
  readonly width: number;
  readonly height: number;
  /** Frees the pixels (ImageBitmap.close). */
  close(): void;
}

/** How an image op paints: the decoded pixels, or a labelled box (its MIME type, or why not). */
export type PaintableImage =
  | { readonly kind: 'drawn'; readonly image: DecodedImage }
  | { readonly kind: 'placeholder'; readonly label: string };

const weight = (entry: PaintableImage): number => (entry.kind === 'drawn' ? entry.image.width * entry.image.height * 4 : 0);

export class ImageCache {
  /** Insertion order is recency: a get moves an entry to the end. */
  private readonly entries: Map<string, PaintableImage> = new Map<string, PaintableImage>();
  private bytes: number = 0;

  constructor(private readonly capBytes: number) {}

  get(contentId: string): PaintableImage | undefined {
    const entry: PaintableImage | undefined = this.entries.get(contentId);
    if (entry !== undefined) {
      this.entries.delete(contentId);
      this.entries.set(contentId, entry);
    }
    return entry;
  }

  has(contentId: string): boolean {
    return this.entries.has(contentId);
  }

  set(contentId: string, entry: PaintableImage): void {
    this.drop(contentId);
    this.entries.set(contentId, entry);
    this.bytes += weight(entry);
    for (const [id] of this.entries) {
      if (this.bytes <= this.capBytes || id === contentId) break;
      this.drop(id);
    }
  }

  /** Decoded pixels held, in bytes. */
  get heldBytes(): number {
    return this.bytes;
  }

  clear(): void {
    for (const id of [...this.entries.keys()]) this.drop(id);
  }

  private drop(contentId: string): void {
    const entry: PaintableImage | undefined = this.entries.get(contentId);
    if (entry === undefined) return;
    this.entries.delete(contentId);
    this.bytes -= weight(entry);
    if (entry.kind === 'drawn') entry.image.close();
  }
}
