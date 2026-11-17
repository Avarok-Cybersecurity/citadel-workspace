/**
 * What this page holds of its console between sends: at most a fixed window's worth of lines,
 * an identical line in a row counted rather than repeated, and nothing from an extension. Pure:
 * time is the injected clock. It is only fed while the member's uploads are allowed, and
 * `clear()` is how consent withdrawn reaches it.
 *
 * The agent paces each session too, and its bound is the one that holds (telemetry/browser.rs);
 * this one keeps a page from sending what the agent would drop.
 */
import type { BrowserConsoleEntry } from 'citadel-workspace-client-ts';
import { fromExtension, type ConsoleLine } from './format';

export interface CaptureClock {
  now(): number;
  /** Runs `fn` once after `ms`; the returned function cancels it. */
  after(ms: number, fn: () => void): () => void;
}

export interface CaptureLimits {
  /** New lines admitted per fixed window; repeats of the last one are counted, not admitted. */
  readonly linesPerWindow: number;
  readonly windowMs: number;
  /** How long a first line waits for company before it is sent. */
  readonly flushMs: number;
  /** Most lines one request carries (the agent's BROWSER_LINES_PER_REQUEST). */
  readonly linesPerRequest: number;
}

export const CAPTURE_LIMITS: CaptureLimits = { linesPerWindow: 8, windowMs: 60_000, flushMs: 5_000, linesPerRequest: 8 };

/** A count the agent reads as a u32. */
const MAX_REPEATS: number = 0xffff_ffff;

function same(entry: BrowserConsoleEntry, line: ConsoleLine): boolean {
  return entry.source === line.source && entry.message === line.message && entry.stack === line.stack;
}

export class ConsoleCaptureBuffer {
  private pending: BrowserConsoleEntry[] = [];
  private windowStart: number | null = null;
  private admitted: number = 0;
  private cancelFlush: (() => void) | null = null;

  constructor(
    private readonly clock: CaptureClock,
    private readonly limits: CaptureLimits,
    private readonly send: (entries: BrowserConsoleEntry[]) => void,
  ) {
    const bounds: number[] = [limits.linesPerWindow, limits.windowMs, limits.flushMs, limits.linesPerRequest];
    if (!bounds.every((bound: number): boolean => Number.isInteger(bound) && bound > 0)) throw new Error('every console capture bound must be a positive integer');
  }

  record(line: ConsoleLine): void {
    if (fromExtension(line)) return;
    const last: number = this.pending.length - 1;
    if (last >= 0 && same(this.pending[last], line)) {
      const entry: BrowserConsoleEntry = this.pending[last];
      this.pending[last] = { ...entry, repeats: Math.min(entry.repeats + 1, MAX_REPEATS) };
      return;
    }
    if (!this.admit()) return;
    this.pending.push({ source: line.source, message: line.message, stack: line.stack, repeats: 1 });
    if (this.cancelFlush === null) this.cancelFlush = this.clock.after(this.limits.flushMs, (): void => this.flush());
  }

  /** Everything held is discarded and nothing more is sent from it. */
  clear(): void {
    this.cancelFlush?.();
    this.cancelFlush = null;
    this.pending = [];
  }

  get held(): number {
    return this.pending.length;
  }

  private admit(): boolean {
    const now: number = this.clock.now();
    if (this.windowStart === null || now < this.windowStart || now - this.windowStart >= this.limits.windowMs) {
      this.windowStart = now;
      this.admitted = 0;
    }
    if (this.admitted >= this.limits.linesPerWindow) return false;
    this.admitted += 1;
    return true;
  }

  private flush(): void {
    this.cancelFlush = null;
    const taken: BrowserConsoleEntry[] = this.pending;
    this.pending = [];
    for (let at: number = 0; at < taken.length; at += this.limits.linesPerRequest) {
      this.send(taken.slice(at, at + this.limits.linesPerRequest));
    }
  }
}
