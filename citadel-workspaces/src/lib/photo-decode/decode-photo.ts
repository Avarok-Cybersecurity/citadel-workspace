/**
 * One photo, in the decoder's worker: the Rust module's answer turned into something an <img>
 * draws. Pure over its ports (SBIO): the module, the browser's own decoder and the canvas are
 * handed in, so the decisions are tested without a worker, a canvas or the binary.
 *
 * 1. Probe (no pixels): over the limits is refused here, before anything is decoded. A camera
 *    RAW's JPEG preview is cut out at this step and needs no decode of ours.
 * 2. When the bytes as they are would be drawn by a browser that knows the format (Safari reads
 *    HEIC and TIFF), the browser's decoder is tried, and the original is drawn as it is.
 * 3. Otherwise the module decodes to RGBA and the canvas encodes it.
 */
import type { PhotoMime } from '@/lib/received-files/raster-sniff';
import type { PhotoRefusal } from './photo-refusal';
import { oriented, type Oriented } from './orientation';

/** The numbers crates/photo-decode/src/wasm.rs AnswerKind declares. */
export const AnswerKind = { Fits: 0, Rgba: 1, Jpeg: 2, TooLarge: 3, Unsupported: 4, Malformed: 5 } as const;

/** The module's answer, as wasm.rs `Answer` exposes it. */
export interface ModuleAnswer {
  readonly kind: number;
  readonly width: number;
  readonly height: number;
  readonly orientation: number;
  readonly flag: boolean;
  readonly detail: string;
  take_data(): Uint8Array;
}

export interface PhotoLimits {
  readonly maxPixels: number;
  readonly maxEdge: number;
}

/** A photo to draw: `blob` null means draw the original bytes, the browser decodes them. */
export interface DecodedPhoto {
  readonly kind: 'decoded';
  readonly blob: Blob | null;
  readonly width: number;
  readonly height: number;
}

export interface DecodePorts {
  readonly module: (bytes: Uint8Array, limits: PhotoLimits, pixels: boolean) => ModuleAnswer;
  /** Whether the browser itself decodes `blob`. */
  readonly drawsNatively: (blob: Blob) => Promise<boolean>;
  readonly encodeRgba: (rgba: Uint8Array, width: number, height: number, orientation: number, opaque: boolean) => Promise<Blob>;
  readonly encodeJpeg: (jpeg: Uint8Array, width: number, height: number, orientation: number) => Promise<Blob>;
}

function refusalOf(answer: ModuleAnswer): PhotoRefusal | null {
  switch (answer.kind) {
    case AnswerKind.TooLarge: return { kind: 'too-large', width: answer.width, height: answer.height };
    case AnswerKind.Unsupported: return { kind: 'unsupported', detail: answer.detail };
    case AnswerKind.Malformed: return { kind: 'unreadable', detail: answer.detail };
    default: return null;
  }
}

/**
 * Per MIME type, whether the browser was found not to decode it: set only when its decoder
 * refused a file that ours then decoded, so a corrupt file never marks a format unsupported.
 */
export type NativeMemo = Map<PhotoMime, false>;

export async function decodePhoto(bytes: Uint8Array, mime: PhotoMime, limits: PhotoLimits, ports: DecodePorts, memo: NativeMemo): Promise<DecodedPhoto | PhotoRefusal> {
  const probe: ModuleAnswer = ports.module(bytes, limits, false);
  const refused: PhotoRefusal | null = refusalOf(probe);
  if (refused !== null) return refused;
  if (probe.kind === AnswerKind.Jpeg) {
    const turned: Oriented = oriented(probe.orientation, probe.width, probe.height);
    const blob: Blob = await ports.encodeJpeg(probe.take_data(), probe.width, probe.height, probe.orientation);
    return { kind: 'decoded', blob, width: turned.width, height: turned.height };
  }
  if (probe.kind !== AnswerKind.Fits) return { kind: 'decoder-failed', detail: `the probe answered ${probe.kind}` };
  const triedNative: boolean = probe.flag && !memo.has(mime);
  if (triedNative && await ports.drawsNatively(new Blob([bytes.slice().buffer], { type: mime }))) {
    return { kind: 'decoded', blob: null, width: probe.width, height: probe.height };
  }
  const full: ModuleAnswer = ports.module(bytes, limits, true);
  const failed: PhotoRefusal | null = refusalOf(full);
  if (failed !== null) return failed;
  if (full.kind !== AnswerKind.Rgba) return { kind: 'decoder-failed', detail: `the decode answered ${full.kind}` };
  if (triedNative) memo.set(mime, false);
  const turned: Oriented = oriented(full.orientation, full.width, full.height);
  const blob: Blob = await ports.encodeRgba(full.take_data(), full.width, full.height, full.orientation, full.flag);
  return { kind: 'decoded', blob, width: turned.width, height: turned.height };
}
