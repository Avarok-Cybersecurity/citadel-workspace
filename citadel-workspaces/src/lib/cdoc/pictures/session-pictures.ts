/**
 * An editor session's pictures: the bridge between the editor in the worker, which holds a
 * picture's bytes only while the document is open, and the document's store (DocumentPictures).
 *
 * - Keeping: a picture added to the document is stored before anything that places it can be
 *   relayed; an imported file's pictures are stored before its replica is handed on.
 * - Drawing: a paint that drew a picture the editor does not hold names it (PageRenderer's
 *   pending pictures); it is fetched, verified, handed to the editor (whose addImage derives the
 *   id again from the bytes: a different id is refused), and the pages that drew it repaint. A
 *   picture that cannot be fetched is drawn as a box saying why.
 * - Exporting: every picture the document names is fetched first, so the file carries them.
 */
import type { CdocClient } from '../worker/cdoc-client';
import type { PageRenderer, PendingPictures } from '../paint/page-renderer';
import type { AddedImage, EditorOrigin } from '../editor/controller';
import type { ImageLookup } from '../paint/image-resolve';
import { decodeImage } from '../editor/wire/decode-v4-records';
import { MAX_IMAGE_BYTES } from '../engine/engine-limits';
import { isLasting, type PictureAccess } from './document-pictures';
import { describePictureFailure, PICTURE_NOT_ADDED, pictureMissingLabel, type PictureFailure, type PictureResult } from './picture-port';

export interface SessionPicturesDeps {
  readonly access: PictureAccess;
  readonly client: CdocClient;
  readonly renderer: PageRenderer;
  /** Has the editor hold `bytes`, of at most `maxBytes` (its addImage, in the session's command order); never stores. */
  readonly hold: (bytes: Uint8Array, maxBytes: number) => Promise<AddedImage>;
  /** Repaints `pages`: a picture they drew as a box has arrived, or failed. */
  readonly repaint: (pages: readonly number[]) => void;
}

/** The label of a picture in a document that keeps none (a read-only file). */
const NO_STORE_LABEL: string = 'picture not available: this document does not keep pictures';
const UNREADABLE_LABEL: string = 'picture not available: not a picture this editor can show';
/** A picture an export waited for that was not fetched (its store is waiting out a retry). */
const NOT_FETCHED_LABEL: string = 'picture not available: it could not be fetched yet';

export class SessionPictures {
  private readonly pagesOf: Map<string, Set<number>> = new Map<string, Set<number>>();
  private readonly bringing: Map<string, Promise<void>> = new Map<string, Promise<void>>();
  private readonly stopListening: () => void;
  private disposed: boolean = false;

  constructor(private readonly deps: SessionPicturesDeps) {
    this.stopListening = deps.renderer.onPendingPictures((pending: PendingPictures): void => this.wanted(pending));
  }

  /**
   * The largest picture this document takes: its store's limit, the only one (the server's, or
   * the device's). Rejects with what the member is told when there is no store, when the store
   * cannot say, or when `size` is over it, so a picture too large is refused before any of it is
   * held or sent.
   */
  private async limitFor(size: number): Promise<number> {
    const max: number = await this.limit();
    if (size > max) throw new Error(`${PICTURE_NOT_ADDED} ${describePictureFailure({ kind: 'tooLarge', maxBytes: max })}`);
    return max;
  }

  /** The store's limit; rejects with what the member is told when there is no store or it cannot say. */
  async limit(): Promise<number> {
    const access: PictureAccess = this.deps.access;
    if (access.kind === 'none') throw new Error(access.reason);
    const limit: PictureResult<number> = await access.pictures.maxBytes();
    if (!limit.ok) throw new Error(`${PICTURE_NOT_ADDED} ${describePictureFailure(limit.failure)}`);
    return limit.value;
  }

  /** A picture added by the member: held within the store's limit, then stored; rejects with what the member is told. */
  async add(bytes: Uint8Array): Promise<AddedImage> {
    const added: AddedImage = await this.deps.hold(bytes, await this.limitFor(bytes.length));
    await this.keep(added.contentId, bytes);
    return added;
  }

  /** Stores `bytes`, which the editor holds as `contentId`; rejects with what the member is told. */
  async keep(contentId: string, bytes: Uint8Array): Promise<void> {
    const access: PictureAccess = this.deps.access;
    if (access.kind === 'none') throw new Error(access.reason);
    const kept: PictureResult<void> = await access.pictures.keep(contentId, bytes);
    if (!kept.ok) throw new Error(`${PICTURE_NOT_ADDED} ${describePictureFailure(kept.failure)}`);
  }

  /** For a replica opened on a file: stores every picture the file brought, before it is used. */
  async keepImported(from: EditorOrigin): Promise<void> {
    if (from.kind !== 'bytes' || this.deps.access.kind === 'none') return;
    for (const contentId of await this.referenced()) {
      const lookup: ImageLookup = await this.lookup(contentId);
      if (lookup.kind === 'held') await this.keep(contentId, decodeImage(lookup.record).bytes);
    }
  }

  /**
   * Fetches every picture the document names that the editor does not hold: before an export.
   * Answers, for each picture still not held after that, the label saying why (none: all held).
   */
  async bringAll(): Promise<string[]> {
    const ids: readonly string[] = await this.referenced();
    const lookups = (): Promise<ImageLookup[]> => Promise.all(ids.map((id: string): Promise<ImageLookup> => this.lookup(id)));
    const before: ImageLookup[] = await lookups();
    await Promise.all(ids.filter((_: string, i: number): boolean => before[i].kind !== 'held').map((id: string): Promise<void> => this.bring(id)));
    return (await lookups()).flatMap((l: ImageLookup): string[] => (l.kind === 'held' ? [] : [l.kind === 'missing' ? l.label : NOT_FETCHED_LABEL]));
  }

  dispose(): void {
    this.disposed = true;
    this.stopListening();
  }

  private async referenced(): Promise<readonly string[]> {
    return (await this.deps.client.request({ kind: 'pictureIds' })).ids;
  }

  private async lookup(contentId: string): Promise<ImageLookup> {
    return (await this.deps.client.request({ kind: 'image', contentId })).lookup;
  }

  private wanted({ pageNumber, contentIds }: PendingPictures): void {
    for (const contentId of contentIds) {
      let pages: Set<number> | undefined = this.pagesOf.get(contentId);
      if (pages === undefined) this.pagesOf.set(contentId, (pages = new Set<number>()));
      pages.add(pageNumber);
      this.bring(contentId).catch((error: unknown): void => {
        if (!this.disposed) console.error('[SessionPictures] a picture could not be brought in', contentId, error);
      });
    }
  }

  /** One bring per id at a time: every paint that drew the picture shares it. */
  private bring(contentId: string): Promise<void> {
    let pending: Promise<void> | undefined = this.bringing.get(contentId);
    if (pending === undefined) {
      pending = this.fetchAndHold(contentId).finally((): void => { this.bringing.delete(contentId); });
      this.bringing.set(contentId, pending);
    }
    return pending;
  }

  private async fetchAndHold(contentId: string): Promise<void> {
    const access: PictureAccess = this.deps.access;
    if (access.kind === 'none') return this.missing(contentId, NO_STORE_LABEL, false);
    const fetching: Promise<PictureResult<Uint8Array>> | null = access.pictures.fetch(contentId);
    if (fetching === null) return;
    const fetched: PictureResult<Uint8Array> = await fetching;
    if (this.disposed) return;
    if (!fetched.ok) return this.failed(contentId, fetched.failure);
    let held: AddedImage;
    try {
      // Fetched from the store, so within its limit when kept; the editor's own ceiling is the bound here.
      held = await this.deps.hold(fetched.value, MAX_IMAGE_BYTES);
    } catch (error: unknown) {
      // The bytes match the id but the editor does not take them (a type it does not draw).
      console.warn('[SessionPictures] the editor did not take a stored picture', contentId, error);
      return this.missing(contentId, UNREADABLE_LABEL, false);
    }
    if (held.contentId !== contentId) return this.failed(contentId, { kind: 'damaged' });
    this.repaintFor(contentId);
  }

  private failed(contentId: string, failure: PictureFailure): Promise<void> {
    return this.missing(contentId, pictureMissingLabel(failure), !isLasting(failure));
  }

  private async missing(contentId: string, label: string, retry: boolean): Promise<void> {
    if (this.disposed) return;
    await this.deps.client.request({ kind: 'pictureMissing', contentId, label, retry });
    this.repaintFor(contentId);
  }

  private repaintFor(contentId: string): void {
    const pages: Set<number> | undefined = this.pagesOf.get(contentId);
    this.pagesOf.delete(contentId);
    if (pages !== undefined && pages.size > 0 && !this.disposed) this.deps.repaint([...pages]);
  }
}
