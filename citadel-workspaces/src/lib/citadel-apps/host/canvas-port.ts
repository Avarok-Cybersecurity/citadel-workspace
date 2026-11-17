/**
 * The worker's CanvasPort: draws an app's commands (generated `DrawCommand`, already schema-checked)
 * on the OffscreenCanvas the page transferred (the cdoc attachCanvas pattern). Colours are u32
 * RGBA; text is drawn as text. No images, no paths from strings, nothing that reads pixels back.
 */
import type { OpReplies } from '../sdk/generated/AbiConstants';
import type { DrawCommand } from '../sdk/generated/DrawCommand';
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
  } else {
    s.fillStyle = rgba(cmd.fill_text.color);
    s.font = font(cmd.fill_text.px);
    s.fillText(cmd.fill_text.text, cmd.fill_text.x, cmd.fill_text.y);
  }
}

const tooLong = (cmd: DrawCommand): boolean => 'fill_text' in cmd && cmd.fill_text.text.length > MAX_TEXT;
const unavailable: PortAnswer<never> = { refused: { unavailable: 'canvas' } };

/** `surface()` is null until the page has attached a canvas. */
export function canvasPort(surface: () => CanvasSurface | null): CanvasPort {
  return {
    CanvasMeasure: (): PortAnswer<OpReplies['CanvasMeasure']> => {
      const s: CanvasSurface | null = surface();
      return s === null ? unavailable : { ok: { width: s.width, height: s.height, dpr: s.dpr } };
    },
    CanvasDraw: ({ commands }): PortAnswer<OpReplies['CanvasDraw']> => {
      const s: CanvasSurface | null = surface();
      if (s === null) return unavailable;
      if (commands.length > MAX_DRAW_COMMANDS || commands.some(tooLong)) return { refused: { limit: 'draw_commands' } };
      for (const cmd of commands) paint(s, cmd);
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
