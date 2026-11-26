/**
 * One document's pictures over its store (PicturePort): what the editor session calls to keep
 * a picture before it is placed, and to fetch one it has to draw. Pure over the port, the
 * content-id function and the clock (SBIO).
 *
 * - Every read is verified: bytes whose content id is not the one asked for are `damaged`, and
 *   never reach the editor (which derives the id again when it takes them).
 * - One request per id at a time: concurrent asks share it.
 * - At most `limits.fetchConcurrency` fetches run at once; the rest wait their turn.
 * - A failure that will not change while the document is open (not found, not permitted, too
 *   large, damaged) is kept and answered again without asking; one that may (offline, the store
 *   unable, full) is asked again only after `limits.retryAfterMs`.
 */
import type { ContentIdOf } from './content-id';
import type { PictureLimits } from './picture-config';
import { failed, isPictureId, ok, type PictureDocument, type PictureFailure, type PicturePort, type PictureResult } from './picture-port';

/** Whether a document keeps pictures, and where: an editor session takes one of these. */
export type PictureAccess =
  | { readonly kind: 'stored'; readonly pictures: DocumentPictures }
  /** No store: pictures cannot be inserted, and `reason` says why. */
  | { readonly kind: 'none'; readonly reason: string };

export interface DocumentPicturesDeps {
  readonly port: PicturePort;
  readonly doc: PictureDocument;
  readonly contentIdOf: ContentIdOf;
  readonly now: () => number;
  readonly limits: PictureLimits;
}

const LASTING: ReadonlySet<PictureFailure['kind']> = new Set<PictureFailure['kind']>(['notFound', 'notPermitted', 'tooLarge', 'damaged']);

/** Whether `failure` holds for as long as the document is open (so it is not asked again). */
export const isLasting = (failure: PictureFailure): boolean => LASTING.has(failure.kind);

interface Failed {
  readonly failure: PictureFailure;
  readonly at: number;
}

export class DocumentPictures {
  private readonly inFlight: Map<string, Promise<PictureResult<Uint8Array>>> = new Map<string, Promise<PictureResult<Uint8Array>>>();
  private readonly failures: Map<string, Failed> = new Map<string, Failed>();
  private readonly waiting: Array<() => void> = [];
  private running: number = 0;
  private limit: Promise<PictureResult<number>> | null = null;

  constructor(private readonly deps: DocumentPicturesDeps) {
    if (!Number.isInteger(deps.limits.fetchConcurrency) || deps.limits.fetchConcurrency < 1) throw new Error('fetchConcurrency must be a positive integer');
  }

  get doc(): PictureDocument {
    return this.deps.doc;
  }

  /** Keeps `bytes` as `contentId`, which must be their content id. */
  async keep(contentId: string, bytes: Uint8Array): Promise<PictureResult<void>> {
    if (!isPictureId(contentId) || (await this.deps.contentIdOf(bytes)) !== contentId) throw new Error(`the bytes kept as ${contentId} are not that picture`);
    const kept: PictureResult<void> = await this.deps.port.put(this.deps.doc, contentId, bytes);
    if (kept.ok) this.failures.delete(contentId);
    return kept;
  }

  /** The largest picture the store keeps for this document, asked once while it is open (a failure is asked again). */
  maxBytes(): Promise<PictureResult<number>> {
    const asked: Promise<PictureResult<number>> = this.limit ?? this.deps.port.maxBytes(this.deps.doc).catch((error: unknown): PictureResult<number> => {
      console.warn('[DocumentPictures] the picture store did not say its limit', error);
      return failed({ kind: 'unavailable', detail: 'The picture store could not be reached.' });
    });
    this.limit = asked;
    void asked.then((result: PictureResult<number>): void => { if (!result.ok && this.limit === asked) this.limit = null; });
    return asked;
  }

  /**
   * The picture `contentId`, verified, or why not. Null while a recent failure that may pass
   * waits out its retry interval: the caller leaves the picture as it is drawn.
   */
  fetch(contentId: string): Promise<PictureResult<Uint8Array>> | null {
    const pending: Promise<PictureResult<Uint8Array>> | undefined = this.inFlight.get(contentId);
    if (pending !== undefined) return pending;
    const last: Failed | undefined = this.failures.get(contentId);
    if (last !== undefined) {
      if (isLasting(last.failure)) return Promise.resolve(failed(last.failure));
      if (this.deps.now() - last.at < this.deps.limits.retryAfterMs) return null;
    }
    const started: Promise<PictureResult<Uint8Array>> = this.turn((): Promise<PictureResult<Uint8Array>> => this.verified(contentId)).then((result: PictureResult<Uint8Array>): PictureResult<Uint8Array> => {
      this.inFlight.delete(contentId);
      if (result.ok) this.failures.delete(contentId);
      else this.failures.set(contentId, { failure: result.failure, at: this.deps.now() });
      return result;
    });
    this.inFlight.set(contentId, started);
    return started;
  }

  private async verified(contentId: string): Promise<PictureResult<Uint8Array>> {
    if (!isPictureId(contentId)) return failed({ kind: 'notFound' });
    const got: PictureResult<Uint8Array> = await this.deps.port.get(this.deps.doc, contentId);
    if (!got.ok) return got;
    return (await this.deps.contentIdOf(got.value)) === contentId ? ok(got.value) : failed({ kind: 'damaged' });
  }

  private async turn(task: () => Promise<PictureResult<Uint8Array>>): Promise<PictureResult<Uint8Array>> {
    if (this.running >= this.deps.limits.fetchConcurrency) await new Promise<void>((resolve: () => void): void => { this.waiting.push(resolve); });
    this.running += 1;
    try {
      return await task();
    } catch (error: unknown) {
      // A store that threw rather than answering could not answer: the member is shown that.
      console.warn('[DocumentPictures] the picture store failed', error);
      return failed({ kind: 'unavailable', detail: 'The picture store could not be read.' });
    } finally {
      this.running -= 1;
      this.waiting.shift()?.();
    }
  }
}
