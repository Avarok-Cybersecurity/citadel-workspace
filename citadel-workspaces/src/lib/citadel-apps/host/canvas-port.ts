/**
 * The worker's CanvasPort: draws an app's commands (generated `DrawCommand`, already schema-checked)
 * on the OffscreenCanvas the page transferred (the cdoc attachCanvas pattern). Colours are u32
 * RGBA; text is drawn as text. No images, no paths from strings, nothing that reads pixels back.
 * The CW-5 commands (circles, paths, arcs) interleave with ABI-1's in order; a frame breaking a
 * CW-5 limit (canvas-limits.ts) is refused before any of it is painted. A `Region` paints nothing:
 * each frame's list goes to `regions` (the page's accessibility overlay), only when it changed.
 */
import type { OpReplies } from '../sdk/generated/AbiConstants';
import type { DrawCommand } from '../sdk/generated/DrawCommand';
import { CANVAS_DRAW_REFUSAL, checkCanvasDraw, sameRegions, type CanvasDrawVerdict, type CanvasRegion } from './canvas-limits';
import type { CanvasPort, PortAnswer } from './ports';

/** The slice of a 2D context the port draws with (an OffscreenCanvasRenderingContext2D). */
export interface CanvasSurface {
  readonly width: number;
  readonly height: number;
  readonly dpr: number;
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  font: string;
  fillRect(x: number, y: number, w: number, h: number): void;
  strokeRect(x: number, y: number, w: number, h: number): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  stroke(): void;
  fill(): void;
  closePath(): void;
  /** Clockwise (`counterclockwise` false) from +x, in radians, as the ABI's `Arc` is. */
  arc(x: number, y: number, r: number, start: number, end: number, counterclockwise: boolean): void;
  fillText(text: string, x: number, y: number): void;
  measureText(text: string): { readonly width: number };
}

export const MAX_DRAW_COMMANDS: number = 4096;
const MAX_TEXT: number = 1024;
const MAX_PX: number = 256;

/** u32 0xRRGGBBAA as CSS. */
export function rgba(color: number): string {
  const c: number = color >>> 0;
  return `rgba(${(c >>> 24) & 0xff}, ${(c >>> 16) & 0xff}, ${(c >>> 8) & 0xff}, ${((c & 0xff) / 255).toFixed(3)})`;
}

const font = (px: number): string => `${Math.min(Math.max(px, 4), MAX_PX)}px sans-serif`;

function paint(s: CanvasSurface, cmd: DrawCommand): void {
  if ('clear' in cmd) {
    s.fillStyle = rgba(cmd.clear.color);
    s.fillRect(0, 0, s.width, s.height);
  } else if ('fill_rect' in cmd) {
    s.fillStyle = rgba(cmd.fill_rect.color);
    s.fillRect(cmd.fill_rect.x, cmd.fill_rect.y, cmd.fill_rect.w, cmd.fill_rect.h);
  } else if ('stroke_rect' in cmd) {
    s.strokeStyle = rgba(cmd.stroke_rect.color);
    s.lineWidth = cmd.stroke_rect.line_width;
    s.strokeRect(cmd.stroke_rect.x, cmd.stroke_rect.y, cmd.stroke_rect.w, cmd.stroke_rect.h);
  } else if ('line' in cmd) {
    const l: Extract<DrawCommand, { line: unknown }>['line'] = cmd.line;
    s.strokeStyle = rgba(l.color);
    s.lineWidth = l.line_width;
    s.beginPath();
    s.moveTo(l.x1, l.y1);
    s.lineTo(l.x2, l.y2);
    s.stroke();
  } else if ('fill_text' in cmd) {
    s.fillStyle = rgba(cmd.fill_text.color);
    s.font = font(cmd.fill_text.px);
    s.fillText(cmd.fill_text.text, cmd.fill_text.x, cmd.fill_text.y);
  } else {
    paintExtension(s, cmd);
  }
}

const FULL_TURN: number = 2 * Math.PI;

function strokeWith(s: CanvasSurface, lineWidth: number, color: number): void {
  s.strokeStyle = rgba(color);
  s.lineWidth = lineWidth;
  s.stroke();
}

function paintExtension(s: CanvasSurface, cmd: Exclude<DrawCommand, { clear: unknown } | { fill_rect: unknown } | { stroke_rect: unknown } | { line: unknown } | { fill_text: unknown }>): void {
  if ('region' in cmd) return;
  s.beginPath();
  if ('fill_circle' in cmd) {
    const c: Extract<DrawCommand, { fill_circle: unknown }>['fill_circle'] = cmd.fill_circle;
    s.arc(c.cx, c.cy, c.r, 0, FULL_TURN, false);
    s.fillStyle = rgba(c.color);
    s.fill();
  } else if ('stroke_circle' in cmd) {
    const c: Extract<DrawCommand, { stroke_circle: unknown }>['stroke_circle'] = cmd.stroke_circle;
    s.arc(c.cx, c.cy, c.r, 0, FULL_TURN, false);
    strokeWith(s, c.line_width, c.color);
  } else if ('arc' in cmd) {
    const a: Extract<DrawCommand, { arc: unknown }>['arc'] = cmd.arc;
    s.arc(a.cx, a.cy, a.r, a.start, a.end, false);
    strokeWith(s, a.line_width, a.color);
  } else {
    const p: Extract<DrawCommand, { path: unknown }>['path'] = cmd.path;
    const [first, ...rest] = p.points;
    s.moveTo(first[0], first[1]);
    for (const [x, y] of rest) s.lineTo(x, y);
    if (p.closed) s.closePath();
    if (p.fill !== null) {
      s.fillStyle = rgba(p.fill);
      s.fill();
    }
    if (p.stroke !== null) strokeWith(s, p.stroke[0], p.stroke[1]);
  }
}

const tooLong = (cmd: DrawCommand): boolean => 'fill_text' in cmd && cmd.fill_text.text.length > MAX_TEXT;
const unavailable: PortAnswer<never> = { refused: { unavailable: 'canvas' } };

/**
 * `surface()` is null until the page has attached a canvas. `regions` is told each painted frame's
 * regions in draw order, whenever they differ from the last frame's (an empty list clears).
 */
export function canvasPort(surface: () => CanvasSurface | null, regions: (list: readonly CanvasRegion[]) => void): CanvasPort {
  let shown: readonly CanvasRegion[] = [];
  return {
    CanvasMeasure: (): PortAnswer<OpReplies['CanvasMeasure']> => {
      const s: CanvasSurface | null = surface();
      return s === null ? unavailable : { ok: { width: s.width, height: s.height, dpr: s.dpr } };
    },
    CanvasDraw: ({ commands }): PortAnswer<OpReplies['CanvasDraw']> => {
      const s: CanvasSurface | null = surface();
      if (s === null) return unavailable;
      if (commands.length > MAX_DRAW_COMMANDS || commands.some(tooLong)) return { refused: { limit: 'draw_commands' } };
      const verdict: CanvasDrawVerdict = checkCanvasDraw(commands);
      if (!verdict.ok) return { refused: CANVAS_DRAW_REFUSAL };
      for (const cmd of commands) paint(s, cmd);
      if (!sameRegions(shown, verdict.regions)) {
        shown = verdict.regions;
        regions(shown);
      }
      return { ok: null };
    },
    MeasureText: ({ text, px }): PortAnswer<OpReplies['MeasureText']> => {
      const s: CanvasSurface | null = surface();
      if (s === null) return unavailable;
      if (text.length > MAX_TEXT) return { refused: { limit: 'text' } };
      s.font = font(px);
      return { ok: { width: s.measureText(text).width } };
    },
  };
}
