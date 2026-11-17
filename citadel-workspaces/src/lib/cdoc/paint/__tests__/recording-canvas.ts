/**
 * A recording stand-in for the canvas platform. Justified: jsdom has no canvas implementation
 * (getContext returns null), and the painter's contract IS the sequence of context calls it
 * makes, so recording them is a direct measurement rather than a simulation. Everything above
 * the context (decoder, placement, rounding, atlas bookkeeping) is the production code.
 */
import type { CanvasPort, Ctx2D, PaintTarget, Surface } from '../canvas-port';
import { fakeImageDecoder, type FakeDecoder } from './fake-image-decoder';

export interface Call {
  readonly name: string;
  readonly args: readonly unknown[];
}

const PROPERTIES: ReadonlySet<string> = new Set<string>(['fillStyle', 'strokeStyle', 'lineWidth', 'lineCap', 'lineJoin', 'globalAlpha', 'font', 'textBaseline']);
/** measureText's stand-in advance: no font engine here, so a fixed width per character. */
export const RECORDED_CHAR_WIDTH: number = 6;

export interface Recorder {
  readonly ctx: Ctx2D;
  readonly calls: Call[];
}

export function recordingContext(label: string): Recorder {
  const calls: Call[] = [];
  const state: Record<string, unknown> = { label };
  const ctx: Ctx2D = new Proxy(state, {
    get(target: Record<string, unknown>, name: string | symbol): unknown {
      if (typeof name !== 'string') return undefined;
      if (PROPERTIES.has(name) || name === 'label') return target[name];
      if (name === 'measureText') {
        return (text: string): { width: number } => {
          calls.push({ name, args: [text] });
          return { width: text.length * RECORDED_CHAR_WIDTH };
        };
      }
      return (...args: unknown[]): void => {
        calls.push({ name, args });
      };
    },
    set(target: Record<string, unknown>, name: string | symbol, value: unknown): boolean {
      if (typeof name !== 'string' || !PROPERTIES.has(name)) throw new Error(`painter set unexpected property ${String(name)}`);
      target[name] = value;
      calls.push({ name: `set ${name}`, args: [value] });
      return true;
    },
  }) as unknown as Ctx2D;
  return { ctx, calls };
}

export class RecordingPath {
  readonly commands: Call[] = [];
  moveTo(...args: number[]): void { this.commands.push({ name: 'moveTo', args }); }
  lineTo(...args: number[]): void { this.commands.push({ name: 'lineTo', args }); }
  quadraticCurveTo(...args: number[]): void { this.commands.push({ name: 'quadraticCurveTo', args }); }
  bezierCurveTo(...args: number[]): void { this.commands.push({ name: 'bezierCurveTo', args }); }
  closePath(): void { this.commands.push({ name: 'closePath', args: [] }); }
}

export interface RecordingPort {
  readonly port: CanvasPort;
  readonly surfaces: Array<Recorder & { readonly width: number; readonly height: number; readonly image: CanvasImageSource }>;
  readonly paths: RecordingPath[];
  /** The images the port decoded (a stand-in for createImageBitmap). */
  readonly images: FakeDecoder;
}

export function recordingPort(): RecordingPort {
  const surfaces: RecordingPort['surfaces'] = [];
  const paths: RecordingPath[] = [];
  const images: FakeDecoder = fakeImageDecoder();
  const port: CanvasPort = {
    createSurface(width: number, height: number): Surface {
      const rec: Recorder = recordingContext(`atlas#${surfaces.length}`);
      const image: CanvasImageSource = { atlas: surfaces.length } as unknown as CanvasImageSource;
      surfaces.push({ ...rec, width, height, image });
      return { ctx: rec.ctx, image };
    },
    createPath(): Path2D {
      const path: RecordingPath = new RecordingPath();
      paths.push(path);
      return path as unknown as Path2D;
    },
    decodeImage: images.decode,
  };
  return { port, surfaces, paths, images };
}

export interface RecordingTarget extends PaintTarget {
  readonly calls: Call[];
  readonly sizes: Array<readonly [number, number]>;
}

export function recordingTarget(): RecordingTarget {
  const rec: Recorder = recordingContext('page');
  const sizes: Array<readonly [number, number]> = [];
  return { ctx: rec.ctx, calls: rec.calls, sizes, resize: (w: number, h: number): void => { sizes.push([w, h]); } };
}

/** A glyph-path record (v1) for a box outline, the shape every synthetic glyph gets. */
export function boxGlyphRecord(xMin: number, yMin: number, xMax: number, yMax: number): Uint8Array {
  const out: DataView = new DataView(new ArrayBuffer(12 + 4 * 5 + 1));
  out.setUint8(0, 1);
  out.setUint16(2, 5, true);
  [xMin, yMin, xMax, yMax].forEach((v: number, i: number) => out.setInt16(4 + 2 * i, v, true));
  let at: number = 12;
  for (const [verb, x, y] of [[0, xMin, yMin], [1, xMax, yMin], [1, xMax, yMax], [1, xMin, yMax]]) {
    out.setUint8(at, verb);
    out.setInt16(at + 1, x, true);
    out.setInt16(at + 3, y, true);
    at += 5;
  }
  out.setUint8(at, 4);
  return new Uint8Array(out.buffer);
}

/** A batch of identical box records for `count` glyphs, in the shape glyphPaths returns. */
export function boxBatch(count: number, record: Uint8Array): { records: Uint8Array; offsets: Uint32Array } {
  const records: Uint8Array = new Uint8Array(record.length * count);
  const offsets: Uint32Array = new Uint32Array(count + 1);
  for (let i: number = 0; i < count; i++) {
    records.set(record, i * record.length);
    offsets[i + 1] = (i + 1) * record.length;
  }
  return { records, offsets };
}
