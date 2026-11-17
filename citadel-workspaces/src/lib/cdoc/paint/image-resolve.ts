/**
 * Turns an image the editor holds into what the painter draws. Only PNG and JPEG are drawn,
 * as the engine draws them in PDF and SVG: anything else (GIF, WebP, BMP, TIFF, EMF, an opaque
 * file) is a placeholder box labelled with its MIME type, as is a PNG or JPEG the platform
 * cannot decode. An id with no bytes here (an image from a peer, in the content store) is a
 * placeholder saying so.
 */
import type { CanvasPort } from './canvas-port';
import type { PaintableImage } from './image-cache';
import { decodeImage, type HeldImage } from '../editor/wire/decode-v4-records';

export const DRAWN_IMAGE_TYPES: ReadonlySet<string> = new Set<string>(['image/png', 'image/jpeg']);

/** The label of an image whose bytes this view does not have. */
export const UNAVAILABLE_IMAGE_LABEL: string = 'image not available';

/** `record`: the "CDB" image record, or null when the editor does not hold that id. */
export async function paintableImage(record: Uint8Array | null, port: CanvasPort): Promise<PaintableImage> {
  if (record === null) return { kind: 'placeholder', label: UNAVAILABLE_IMAGE_LABEL };
  const held: HeldImage = decodeImage(record);
  if (!DRAWN_IMAGE_TYPES.has(held.mime)) return { kind: 'placeholder', label: held.mime };
  try {
    return { kind: 'drawn', image: await port.decodeImage(held.bytes, held.mime) };
  } catch {
    // The decode failure is shown: the box names the type the platform could not decode.
    return { kind: 'placeholder', label: `${held.mime} (could not be decoded)` };
  }
}

/** Where an image's "CDB" record comes from: the editor in the worker, or a request to it. Null: not held. */
export type ImageRecordSource = (contentId: string) => Promise<Uint8Array | null>;

/**
 * Resolves the images a page draws before it paints, each id once: concurrent paints of pages
 * sharing an image wait for the same decode.
 */
export class ImageResolver {
  private readonly inFlight: Map<string, Promise<PaintableImage>> = new Map<string, Promise<PaintableImage>>();

  constructor(private readonly port: CanvasPort, private readonly records: ImageRecordSource) {}

  async fill(painter: ImageSink, pageNumber: number): Promise<void> {
    await Promise.all(painter.missingImages(pageNumber).map(async (contentId: string): Promise<void> => {
      painter.addImage(contentId, await this.resolve(contentId));
    }));
  }

  private resolve(contentId: string): Promise<PaintableImage> {
    let pending: Promise<PaintableImage> | undefined = this.inFlight.get(contentId);
    if (pending === undefined) {
      pending = this.records(contentId).then((record: Uint8Array | null): Promise<PaintableImage> => paintableImage(record, this.port));
      this.inFlight.set(contentId, pending);
      const settled = (): void => { this.inFlight.delete(contentId); };
      pending.then(settled, settled);
    }
    return pending;
  }
}

/** What the resolver fills: a painter's image cache (PageRasterizer). */
export interface ImageSink {
  missingImages(pageNumber: number): string[];
  addImage(contentId: string, image: PaintableImage): void;
}
