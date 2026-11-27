/**
 * A chat file's picture: its bytes read (a received file from the agent, a sent one from this
 * tab), checked as a picture within the limits (decoded by the page when it is a photo format the
 * browser may not draw), and given an object URL. One load per transfer, shared by the bubble and
 * the viewer, and bounded: the oldest is released, and reads and decodes pass the preview gate, so
 * a conversation of RAW files is read one at a time. A photo the decoder refused keeps its bytes:
 * it is still a file to save.
 *
 * Pure over its I/O (SBIO): reading, decoding and the object URL are handed in.
 */
import type { FileTransfer } from '@/lib/file-transfer/types';
import { readReceivedFile, type ReceivedFileIO, type ReceivedFileRead } from './received-file';
import { previewByteLimit, previewReservation } from './image-preview';
import type { PreviewGate } from './preview-gate';
import type { Dimensions } from './image-dimensions';
import { drawnOrRefused, type DecodePhoto, type DrawnPicture, type RefusedPicture } from './shown-picture';

export interface ShownPicture {
  /** An object URL of what is drawn. */
  readonly url: string;
  /** The original bytes, typed by what they are: what Download saves. */
  readonly blob: Blob;
  readonly picture: { readonly size: Dimensions };
}

export type PictureLoad = ShownPicture | RefusedPicture | { readonly unavailable: string };

export interface PictureIO {
  readonly received: ReceivedFileIO;
  readonly sent: (transfer: FileTransfer) => Promise<Blob | undefined>;
  readonly decode: DecodePhoto;
  readonly objectUrl: (blob: Blob) => string;
  readonly release: (url: string) => void;
}

async function bytesOf(transfer: FileTransfer, io: PictureIO): Promise<Uint8Array | string> {
  if (!transfer.isIncoming) {
    const blob: Blob | undefined = await io.sent(transfer);
    return blob ? new Uint8Array(await blob.arrayBuffer()) : 'the full picture was not kept on this device';
  }
  if (transfer.state !== 'complete') return 'it has not arrived yet';
  const read: ReceivedFileRead = await readReceivedFile(transfer, io.received, previewByteLimit(transfer.fileName));
  return read.kind === 'read' ? read.file.bytes : read.reason;
}

export async function loadPicture(transfer: FileTransfer, io: PictureIO): Promise<PictureLoad> {
  const bytes: Uint8Array | string = await bytesOf(transfer, io);
  if (typeof bytes === 'string') return { unavailable: bytes };
  const drawn: DrawnPicture | RefusedPicture | string = await drawnOrRefused(bytes, io.decode);
  if (typeof drawn === 'string') return { unavailable: drawn };
  if ('refusal' in drawn) return drawn;
  return { url: io.objectUrl(drawn.display), blob: drawn.original, picture: { size: drawn.size } };
}

const MAX_LOADED: number = 32;

/** Loads by transfer id, once; the oldest load past the bound is released. */
export class PictureCache {
  private readonly loads: Map<string, Promise<PictureLoad>> = new Map();

  constructor(private readonly io: PictureIO, private readonly gate: PreviewGate) {}

  get(transfer: FileTransfer): Promise<PictureLoad> {
    const known: Promise<PictureLoad> | undefined = this.loads.get(transfer.id);
    if (known) return known;
    const load: Promise<PictureLoad> = this.gate.run(previewReservation(transfer.fileName), (): Promise<PictureLoad> => loadPicture(transfer, this.io));
    this.loads.set(transfer.id, load);
    // A load that drew nothing is not kept: the file may arrive, the agent come back, or the
    // decoder load on a second try.
    void load.then((done: PictureLoad): void => { if (!('url' in done)) this.forget(transfer.id, load); }, (): void => this.forget(transfer.id, load));
    while (this.loads.size > MAX_LOADED) this.evictOldest();
    return load;
  }

  /** Forgets a load that drew nothing, unless a newer load for the transfer has replaced it. */
  private forget(id: string, load: Promise<PictureLoad>): void {
    if (this.loads.get(id) === load) this.loads.delete(id);
  }

  private evictOldest(): void {
    const oldest: string | undefined = this.loads.keys().next().value;
    if (oldest === undefined) return;
    const load: Promise<PictureLoad> | undefined = this.loads.get(oldest);
    this.loads.delete(oldest);
    void load?.then((done: PictureLoad): void => { if ('url' in done) this.io.release(done.url); });
  }
}
