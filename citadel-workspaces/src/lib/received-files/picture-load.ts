/**
 * A chat file's picture: its bytes read (a received file from the agent, a sent one from this
 * tab), checked as a raster image within the limits, and given an object URL. One load per
 * transfer, shared by the bubble and the viewer, and bounded: the oldest is released.
 *
 * Pure over its I/O (SBIO): reading and the object URL are handed in.
 */
import type { FileTransfer } from '@/lib/file-transfer/types';
import { readReceivedFile, type ReceivedFileIO, type ReceivedFileRead } from './received-file';
import { MAX_PREVIEW_BYTES, pictureOf, type Picture } from './image-preview';

export interface ShownPicture {
  readonly url: string;
  readonly blob: Blob;
  readonly picture: Picture;
}

export type PictureLoad = ShownPicture | { readonly unavailable: string };

export interface PictureIO {
  readonly received: ReceivedFileIO;
  readonly sent: (transfer: FileTransfer) => Promise<Blob | undefined>;
  readonly objectUrl: (blob: Blob) => string;
  readonly release: (url: string) => void;
}

async function bytesOf(transfer: FileTransfer, io: PictureIO): Promise<Uint8Array | string> {
  if (!transfer.isIncoming) {
    const blob: Blob | undefined = await io.sent(transfer);
    return blob ? new Uint8Array(await blob.arrayBuffer()) : 'the full picture was not kept on this device';
  }
  if (transfer.state !== 'complete') return 'it has not arrived yet';
  const read: ReceivedFileRead = await readReceivedFile(transfer, io.received, MAX_PREVIEW_BYTES);
  return read.kind === 'read' ? read.file.bytes : read.reason;
}

export async function loadPicture(transfer: FileTransfer, io: PictureIO): Promise<PictureLoad> {
  const bytes: Uint8Array | string = await bytesOf(transfer, io);
  if (typeof bytes === 'string') return { unavailable: bytes };
  const picture: Picture | string = pictureOf(bytes);
  if (typeof picture === 'string') return { unavailable: picture };
  const blob: Blob = new Blob([bytes.slice().buffer], { type: picture.mime });
  return { url: io.objectUrl(blob), blob, picture };
}

const MAX_LOADED: number = 32;

/** Loads by transfer id, once; the oldest load past the bound is released. */
export class PictureCache {
  private readonly loads: Map<string, Promise<PictureLoad>> = new Map();

  constructor(private readonly io: PictureIO) {}

  get(transfer: FileTransfer): Promise<PictureLoad> {
    const known: Promise<PictureLoad> | undefined = this.loads.get(transfer.id);
    if (known) return known;
    const load: Promise<PictureLoad> = loadPicture(transfer, this.io);
    this.loads.set(transfer.id, load);
    // A load that found nothing is not kept: the file may arrive, or the agent come back.
    void load.then((done: PictureLoad): void => { if ('unavailable' in done) this.loads.delete(transfer.id); });
    while (this.loads.size > MAX_LOADED) this.evictOldest();
    return load;
  }

  private evictOldest(): void {
    const oldest: string | undefined = this.loads.keys().next().value;
    if (oldest === undefined) return;
    const load: Promise<PictureLoad> | undefined = this.loads.get(oldest);
    this.loads.delete(oldest);
    void load?.then((done: PictureLoad): void => { if ('url' in done) this.io.release(done.url); });
  }
}
