/**
 * The worker's canvas port over a recording surface. Arguments reach it schema-checked (the
 * off-shape cases are dispatch.test.ts's `bad_arguments`); here: what is drawn, u32 RGBA colours,
 * the command and text caps, and nothing before a canvas is attached.
 */
import { describe, expect, it } from 'vitest';
import type { DrawCommand } from '../../sdk/generated/DrawCommand';
import { canvasPort, MAX_DRAW_COMMANDS, rgba, type CanvasSurface } from '../canvas-port';
import type { CanvasPort } from '../ports';

function surface(): CanvasSurface & { readonly calls: string[] } {
  const calls: string[] = [];
  return {
    calls, width: 300, height: 150, dpr: 2, fillStyle: '#000000', strokeStyle: '#000000', lineWidth: 1, font: '',
    fillRect: (x: number, y: number, w: number, h: number): void => { calls.push(`rect ${x} ${y} ${w} ${h}`); },
    strokeRect: (x: number, y: number, w: number, h: number): void => { calls.push(`stroke ${x} ${y} ${w} ${h}`); },
    beginPath: (): void => { calls.push('path'); },
    moveTo: (x: number, y: number): void => { calls.push(`move ${x} ${y}`); },
    lineTo: (x: number, y: number): void => { calls.push(`line ${x} ${y}`); },
    stroke: (): void => { calls.push('stroke'); },
    fillText: (t: string): void => { calls.push(`text ${t}`); },
    measureText: (t: string): { readonly width: number } => ({ width: t.length * 7 }),
  };
}

const RED: number = 0xff0000ff;

describe('canvasPort', () => {
  it('draws every command, as text where it is text, and reports its size', () => {
    const s: CanvasSurface & { readonly calls: string[] } = surface();
    const port: CanvasPort = canvasPort(() => s);
    const commands: DrawCommand[] = [
      { clear: { color: 0 } },
      { fill_rect: { x: 1, y: 2, w: 3, h: 4, color: RED } },
      { line: { x1: 0, y1: 0, x2: 5, y2: 5, line_width: 1, color: RED } },
      { fill_text: { x: 0, y: 9, px: 12, text: '<b>hi</b>', color: RED } },
    ];
    expect(port.CanvasDraw({ commands })).toEqual({ ok: null });
    expect(s.calls).toEqual(['rect 0 0 300 150', 'rect 1 2 3 4', 'path', 'move 0 0', 'line 5 5', 'stroke', 'text <b>hi</b>']);
    expect(port.CanvasMeasure({})).toEqual({ ok: { width: 300, height: 150, dpr: 2 } });
    expect(port.MeasureText({ text: 'abc', px: 12 })).toEqual({ ok: { width: 21 } });
  });

  it('colours are u32 0xRRGGBBAA', () => {
    expect(rgba(RED)).toBe('rgba(255, 0, 0, 1.000)');
    expect(rgba(0x00ff0080)).toBe('rgba(0, 255, 0, 0.502)');
  });

  it('refuses a batch over the command cap and draws none of it (control: at the cap draws)', () => {
    const s: CanvasSurface & { readonly calls: string[] } = surface();
    const one: DrawCommand = { clear: { color: 0 } };
    expect(canvasPort(() => s).CanvasDraw({ commands: Array.from({ length: MAX_DRAW_COMMANDS + 1 }, () => one) })).toEqual({ refused: { limit: 'draw_commands' } });
    expect(s.calls).toEqual([]);
    expect(canvasPort(() => s).CanvasDraw({ commands: Array.from({ length: MAX_DRAW_COMMANDS }, () => one) })).toEqual({ ok: null });
  });

  it('is unavailable until a canvas is attached', () => {
    expect(canvasPort(() => null).CanvasDraw({ commands: [] })).toEqual({ refused: { unavailable: 'canvas' } });
    expect(canvasPort(() => null).CanvasMeasure({})).toEqual({ refused: { unavailable: 'canvas' } });
  });
});
