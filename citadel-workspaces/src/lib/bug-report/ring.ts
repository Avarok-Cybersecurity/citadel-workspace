/**
 * The page's last console errors and warnings, held in memory for a bug report and nowhere else:
 * nothing here is sent until a person presses Send (RECOVERY-DESIGN.md §3.1). Installed first in
 * main.tsx, so a crash while React starts is held too.
 *
 * Each line is made exactly as opt-in telemetry makes it (console-capture/format.ts: strings,
 * primitives and errors only, bounded, extensions dropped), then redacted (redact.ts). The ring
 * and telemetry's capture each wrap the console; hook.ts lets them stack.
 */
import { fromExtension, lineFrom, type ConsoleLevel, type ConsoleLine } from '@/lib/telemetry/console-capture/format';
import { hookConsole, type ConsoleTarget } from '@/lib/telemetry/console-capture/hook';
import { redactText } from './redact';
import type { BrowserConsoleEntry } from 'citadel-workspace-client-ts';

/** A console line as telemetry forwards it (the generated entry), with when this page saw it. */
export type RingLine = Readonly<BrowserConsoleEntry & { at: number }>;

export const RING_LINES: number = 200;

export class ConsoleRing {
  private lines: RingLine[] = [];

  constructor(private readonly limit: number, private readonly now: () => number) {
    if (!Number.isInteger(limit) || limit <= 0) throw new Error('a console ring holds a positive whole number of lines');
  }

  record(level: ConsoleLevel, args: readonly unknown[]): void {
    const line: ConsoleLine = lineFrom(level, args);
    if (fromExtension(line)) return;
    const message: string = redactText(line.message);
    const stack: string | null = line.stack === null ? null : redactText(line.stack);
    const last: RingLine | undefined = this.lines.at(-1);
    if (last !== undefined && last.source === line.source && last.message === message && last.stack === stack) {
      this.lines[this.lines.length - 1] = { ...last, repeats: last.repeats + 1 };
      return;
    }
    this.lines.push({ at: this.now(), source: line.source, message, stack, repeats: 1 });
    if (this.lines.length > this.limit) this.lines.splice(0, this.lines.length - this.limit);
  }

  snapshot(): readonly RingLine[] {
    return [...this.lines];
  }
}

let installed: ConsoleRing | null = null;

/** Starts holding this page's console lines; a second call keeps the first ring. */
export function installConsoleRing(target: ConsoleTarget, now: () => number): ConsoleRing {
  if (installed !== null) return installed;
  const ring: ConsoleRing = new ConsoleRing(RING_LINES, now);
  installed = ring;
  // A ring that failed on a line stops holding lines; the page's own console call already ran.
  const unhook: () => void = hookConsole(target, (level: ConsoleLevel, args: readonly unknown[]): void => ring.record(level, args), (): void => unhook());
  return ring;
}

/** What the ring holds now; empty when it was never installed. */
export function consoleRingSnapshot(): readonly RingLine[] {
  return installed === null ? [] : installed.snapshot();
}
