/**
 * Turns an image the editor holds into what the painter draws. Only PNG and JPEG are drawn,
 * as the engine draws them in PDF and SVG: anything else (GIF, WebP, BMP, TIFF, EMF, an opaque
 * file) is a placeholder box labelled with its MIME type, as is a PNG or JPEG the platform
 * cannot decode. A picture the editor does not hold yet (its bytes are in the document's store,
 * lib/cdoc/pictures) is drawn as a box saying it is loading, and a picture that could not be
 * fetched as a box saying why; neither is cached, so the picture is drawn once it arrives.
 */
import type { CanvasPort } from './canvas-port';
import type { PaintableImage } from './image-cache';
import { decodeImage, type HeldImage } from '../editor/wire/decode-v4-records';

export const DRAWN_IMAGE_TYPES: ReadonlySet<string> = new Set<string>(['image/png', 'image/jpeg']);

/** The label of an image whose bytes this view does not have and cannot fetch (a read-only file's). */
export const UNAVAILABLE_IMAGE_LABEL: string = 'image not available';

/** The label of a picture on its way from the document's store. */
export const LOADING_IMAGE_LABEL: string = 'loading picture…';

/** What the editor's side knows of a picture a page draws. */
export type ImageLookup =
  /** The editor holds it: its "CDB" record. */
  | { readonly kind: 'held'; readonly record: Uint8Array }
  /** Not held, and nobody has said it cannot be: it is being fetched. */
  | { readonly kind: 'pending' }
  /** It could not be fetched: `label` says why; `retry` when asking again may succeed. */
  | { readonly kind: 'missing'; readonly label: string; readonly retry: boolean };

/** `record`: the "CDB" image record of a picture the editor holds. */
export async function paintableImage(record: Uint8Array, port: CanvasPort): Promise<PaintableImage> {
  const held: HeldImage = decodeImage(record);
  if (!DRAWN_IMAGE_TYPES.has(held.mime)) return { kind: 'placeholder', label: held.mime };
  try {
    return { kind: 'drawn', image: await port.decodeImage(held.bytes, held.mime) };
  } catch {
    // The decode failure is shown: the box names the type the platform could not decode.
    return { kind: 'placeholder', label: `${held.mime} (could not be decoded)` };
  }
}

/** Where a picture's lookup comes from: the editor in the worker, or a request to it. */
export type ImageLookupSource = (contentId: string) => Promise<ImageLookup>;

/** A picture resolved for one paint: decoded (cached by the painter), or a box for now. */
type Resolved =
  | { readonly kind: 'image'; readonly image: PaintableImage }
  | { readonly kind: 'transient'; readonly label: string; readonly wanted: boolean };

async function resolved(lookup: ImageLookup, port: CanvasPort): Promise<Resolved> {
  switch (lookup.kind) {
    case 'held': return { kind: 'image', image: await paintableImage(lookup.record, port) };
    case 'pending': return { kind: 'transient', label: LOADING_IMAGE_LABEL, wanted: true };
    case 'missing': return { kind: 'transient', label: lookup.label, wanted: lookup.retry };
  }
}

/**
 * Resolves the images a page draws before it paints, each id once: concurrent paints of pages
 * sharing an image wait for the same decode. `fill` answers the ids the page drew as boxes that
 * are worth fetching (pending, or failed in a way that may pass), for the editor session to fetch.
 */
export class ImageResolver {
  private readonly inFlight: Map<string, Promise<Resolved>> = new Map<string, Promise<Resolved>>();

  constructor(private readonly port: CanvasPort, private readonly lookups: ImageLookupSource) {}

  async fill(painter: ImageSink, pageNumber: number): Promise<string[]> {
    const wanted: string[] = [];
    await Promise.all(painter.missingImages(pageNumber).map(async (contentId: string): Promise<void> => {
      const r: Resolved = await this.resolve(contentId);
      if (r.kind === 'image') return painter.addImage(contentId, r.image);
      painter.showFor(contentId, r.label);
      if (r.wanted) wanted.push(contentId);
    }));
    return wanted;
  }

  private resolve(contentId: string): Promise<Resolved> {
    let pending: Promise<Resolved> | undefined = this.inFlight.get(contentId);
    if (pending === undefined) {
      pending = this.lookups(contentId).then((lookup: ImageLookup): Promise<Resolved> => resolved(lookup, this.port));
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
  /** Draws `contentId` as a box labelled `label` until it is resolved: never cached. */
  showFor(contentId: string, label: string): void;
}
