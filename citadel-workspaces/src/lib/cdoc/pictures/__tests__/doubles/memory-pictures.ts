/**
 * A PicturePort kept in memory, for tests of what sits above the port (DocumentPictures, the
 * editor session): the backends are tested on their own against their real stores. Faithful to
 * the port: bytes under (document, id), a get of what nobody put is `notFound`. It never checks
 * a hash, as a backend need not; `tamper` replaces what a get returns, `fail` makes every call
 * fail, so the verification above it can be shown to discriminate.
 */
import { failed, ok, type PictureDocument, type PictureFailure, type PicturePort, type PictureResult } from '../../picture-port';
import { DocumentPictures, type PictureAccess } from '../../document-pictures';
import type { PicturePlan } from '../../picture-plan';
import { sha256ContentId } from '../../content-id';
import { PICTURE_LIMITS } from '../../picture-config';

export interface MemoryPictures extends PicturePort {
  /** Every put, in order. */
  readonly puts: Array<{ readonly doc: PictureDocument; readonly contentId: string }>;
  /** Every get, in order. */
  readonly gets: Array<{ readonly doc: PictureDocument; readonly contentId: string }>;
  /** Makes the next gets of `contentId` answer `bytes` instead of what was stored. */
  tamper(contentId: string, bytes: Uint8Array): void;
  /** Every later call fails with `failure` (null: back to normal). */
  fail(failure: PictureFailure | null): void;
  /** Holds every get until the returned release is called. */
  hold(): () => void;
}

const keyOf = (doc: PictureDocument, contentId: string): string => {
  switch (doc.kind) {
    case 'page': return `page:${doc.nodeId}:${contentId}`;
    case 'nodeChat': return `chat:${doc.nodeId}:${doc.chatDoc}:${contentId}`;
    case 'pair': return `pair:${doc.selfCid.toString()}:${doc.peerCid.toString()}:${doc.docId}:${contentId}`;
    case 'scratchpad': return `scratch:${doc.account.toString()}:${doc.docId}:${contentId}`;
  }
};

export function memoryPictures(): MemoryPictures {
  const kept: Map<string, Uint8Array> = new Map<string, Uint8Array>();
  const tampered: Map<string, Uint8Array> = new Map<string, Uint8Array>();
  const puts: Array<{ readonly doc: PictureDocument; readonly contentId: string }> = [];
  const gets: Array<{ readonly doc: PictureDocument; readonly contentId: string }> = [];
  let failing: PictureFailure | null = null;
  let gate: Promise<void> = Promise.resolve();
  return {
    puts,
    gets,
    put: async (doc: PictureDocument, contentId: string, bytes: Uint8Array): Promise<PictureResult<void>> => {
      puts.push({ doc, contentId });
      if (failing !== null) return failed(failing);
      kept.set(keyOf(doc, contentId), bytes.slice());
      return ok(undefined);
    },
    get: async (doc: PictureDocument, contentId: string): Promise<PictureResult<Uint8Array>> => {
      gets.push({ doc, contentId });
      await gate;
      if (failing !== null) return failed(failing);
      const bytes: Uint8Array | undefined = tampered.get(contentId) ?? kept.get(keyOf(doc, contentId));
      return bytes === undefined ? failed({ kind: 'notFound' }) : ok(bytes.slice());
    },
    tamper: (contentId: string, bytes: Uint8Array): void => { tampered.set(contentId, bytes); },
    fail: (failure: PictureFailure | null): void => { failing = failure; },
    hold: (): (() => void) => {
      let release: () => void = (): void => undefined;
      gate = new Promise<void>((resolve: () => void): void => { release = resolve; });
      return (): void => { release(); gate = Promise.resolve(); };
    },
  };
}

/** A real 4×3 RGB PNG. */
export const PNG_4X3: Uint8Array = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAIAAAA7ljmRAAAAJ0lEQVR4nBXCsQ0AMAzDMM2eM/sS/w+dVZQggkROin/s2eJwcef6ANrTC31jHAgcAAAAAElFTkSuQmCC'), (c: string): number => c.charCodeAt(0));

/** A document whose pictures are kept in `port`, as the app's plans load them. */
export function memoryPicturePlan(port: PicturePort, doc: PictureDocument): PicturePlan {
  return {
    kind: 'stored',
    load: async (): Promise<PictureAccess> => ({ kind: 'stored', pictures: new DocumentPictures({ port, doc, contentIdOf: sha256ContentId, now: (): number => Date.now(), limits: PICTURE_LIMITS }) }),
  };
}
