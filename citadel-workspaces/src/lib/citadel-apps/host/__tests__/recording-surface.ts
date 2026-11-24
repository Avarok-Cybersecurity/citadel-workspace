/**
 * TEST HELPER: a CanvasSurface that records each drawing call as a line of text, so a test reads
 * what was painted, in order. It stands in for the OffscreenCanvas 2D context only: jsdom and Node
 * have no canvas, and the port's job is the calls it makes, not the pixels a browser makes of them.
 */
import type { CanvasSurface } from '../canvas-port';

export type RecordingSurface = CanvasSurface & { readonly calls: string[] };

export function recordingSurface(): RecordingSurface {
  const calls: string[] = [];
  const s: RecordingSurface = {
    calls, width: 300, height: 150, dpr: 2, fillStyle: '#000000', strokeStyle: '#000000', lineWidth: 1, font: '',
    fillRect: (x: number, y: number, w: number, h: number): void => { calls.push(`rect ${x} ${y} ${w} ${h}`); },
    strokeRect: (x: number, y: number, w: number, h: number): void => { calls.push(`stroke ${x} ${y} ${w} ${h}`); },
    beginPath: (): void => { calls.push('path'); },
    moveTo: (x: number, y: number): void => { calls.push(`move ${x} ${y}`); },
    lineTo: (x: number, y: number): void => { calls.push(`line ${x} ${y}`); },
    stroke: (): void => { calls.push(`stroke ${String(s.strokeStyle)} ${s.lineWidth}`); },
    fill: (): void => { calls.push(`fill ${String(s.fillStyle)}`); },
    closePath: (): void => { calls.push('close'); },
    arc: (x: number, y: number, r: number, start: number, end: number, ccw: boolean): void => {
      calls.push(`arc ${x} ${y} ${r} ${start.toFixed(3)} ${end.toFixed(3)}${ccw ? ' ccw' : ''}`);
    },
    fillText: (t: string): void => { calls.push(`text ${t}`); },
    measureText: (t: string): { readonly width: number } => ({ width: t.length * 7 }),
  };
  return s;
}
