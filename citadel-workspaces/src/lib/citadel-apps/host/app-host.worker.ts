/**
 * The app instance's dedicated module Worker. In this order: capture the host channel and the
 * clock, scrub ambient authority from `self`, and only then start the host that instantiates the
 * app. If any name survives the scrub, no app runs in this worker at all.
 */
import type { DispatchClock } from './dispatch';
import type { CanvasSurface } from './canvas-port';
import { AMBIENT_AUTHORITY, captureChannel, scrubAmbientAuthority } from './scrub';
import { startWorkerHost } from './worker-host';
import type { FromWorker, WorkerChannel } from './worker-protocol';

interface HostScope {
  postMessage(message: FromWorker): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
  setTimeout(fire: () => void, ms: number): number;
  clearTimeout(id: number): void;
  performance: { now(): number };
}

const scope: HostScope = self as unknown as HostScope;
const channel: WorkerChannel = captureChannel(scope);
const setTimer: HostScope['setTimeout'] = scope.setTimeout.bind(scope);
const clearTimer: HostScope['clearTimeout'] = scope.clearTimeout.bind(scope);
const perf: HostScope['performance'] = scope.performance;

const clock: DispatchClock = {
  now: (): number => perf.now(),
  after: (ms: number, fire: () => void): (() => void) => {
    const id: number = setTimer(fire, ms);
    return (): void => clearTimer(id);
  },
};

/**
 * The app draws in CSS pixels (citadel-app-sdk-types calls/canvas.rs); the bitmap is `dpr` times
 * that, so the context is scaled once and the surface reports its size in CSS pixels.
 */
function surfaceOf(canvas: OffscreenCanvas, dpr: number): CanvasSurface | null {
  const ctx: OffscreenCanvasRenderingContext2D | null = canvas.getContext('2d');
  if (ctx === null) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return {
    get width(): number { return Math.round(canvas.width / dpr); },
    get height(): number { return Math.round(canvas.height / dpr); },
    dpr,
    get fillStyle(): string | CanvasGradient | CanvasPattern { return ctx.fillStyle; },
    set fillStyle(v: string | CanvasGradient | CanvasPattern) { ctx.fillStyle = v; },
    get strokeStyle(): string | CanvasGradient | CanvasPattern { return ctx.strokeStyle; },
    set strokeStyle(v: string | CanvasGradient | CanvasPattern) { ctx.strokeStyle = v; },
    get lineWidth(): number { return ctx.lineWidth; },
    set lineWidth(v: number) { ctx.lineWidth = v; },
    get font(): string { return ctx.font; },
    set font(v: string) { ctx.font = v; },
    fillRect: (x: number, y: number, w: number, h: number): void => ctx.fillRect(x, y, w, h),
    strokeRect: (x: number, y: number, w: number, h: number): void => ctx.strokeRect(x, y, w, h),
    beginPath: (): void => ctx.beginPath(),
    moveTo: (x: number, y: number): void => ctx.moveTo(x, y),
    lineTo: (x: number, y: number): void => ctx.lineTo(x, y),
    stroke: (): void => ctx.stroke(),
    fillText: (text: string, x: number, y: number): void => ctx.fillText(text, x, y),
    measureText: (text: string): { readonly width: number } => ({ width: ctx.measureText(text).width }),
  };
}

const survivors: string[] = scrubAmbientAuthority(self, AMBIENT_AUTHORITY);
if (survivors.length > 0) {
  channel.post({ kind: 'trapped', seq: 0, message: `the worker could not remove ${survivors.join(', ')}`, memoryPages: 0 });
} else {
  startWorkerHost(channel, clock, surfaceOf);
}
