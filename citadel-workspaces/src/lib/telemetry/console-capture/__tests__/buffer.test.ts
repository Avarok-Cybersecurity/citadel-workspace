import { describe, expect, it } from 'vitest';
import type { BrowserConsoleEntry } from 'citadel-workspace-client-ts';
import { ConsoleCaptureBuffer, type CaptureLimits } from '../buffer';
import type { ConsoleLine } from '../format';
import { ManualClock } from './fakes';

const LIMITS: CaptureLimits = { linesPerWindow: 3, windowMs: 60_000, flushMs: 5_000, linesPerRequest: 2 };
const line = (message: string, stack: string | null = null): ConsoleLine => ({ source: 'ConsoleError', message, stack });

function setup(limits: CaptureLimits = LIMITS): { clock: ManualClock; buffer: ConsoleCaptureBuffer; sent: BrowserConsoleEntry[][] } {
  const clock: ManualClock = new ManualClock();
  const sent: BrowserConsoleEntry[][] = [];
  return { clock, buffer: new ConsoleCaptureBuffer(clock, limits, (entries) => { sent.push(entries); }), sent };
}

describe('the console capture buffer', () => {
  it('refuses a bound that is not a positive integer', () => {
    const clock: ManualClock = new ManualClock();
    expect(() => new ConsoleCaptureBuffer(clock, { ...LIMITS, windowMs: 0 }, () => undefined)).toThrow();
    expect(() => new ConsoleCaptureBuffer(clock, { ...LIMITS, linesPerWindow: 1.5 }, () => undefined)).toThrow();
  });

  it('sends after the flush delay, in requests of the bounded size', () => {
    const { clock, buffer, sent } = setup();
    buffer.record(line('a'));
    buffer.record(line('b'));
    buffer.record(line('c'));
    clock.advance(4_999);
    expect(sent).toEqual([]);
    clock.advance(1);
    expect(sent.map((r) => r.map((e) => e.message))).toEqual([['a', 'b'], ['c']]);
  });

  it('admits a fixed number of new lines per window', () => {
    const { clock, buffer, sent } = setup();
    for (let i: number = 0; i < 10; i += 1) buffer.record(line(`l${i}`));
    clock.advance(5_000);
    expect(sent.flat().map((e) => e.message)).toEqual(['l0', 'l1', 'l2']);
    clock.advance(55_000);
    buffer.record(line('next window'));
    clock.advance(5_000);
    expect(sent.flat().map((e) => e.message)).toContain('next window');
  });

  it('counts an identical line in a row instead of holding it again', () => {
    const { clock, buffer, sent } = setup();
    for (let i: number = 0; i < 50; i += 1) buffer.record(line('same', 'at f'));
    buffer.record(line('other'));
    clock.advance(5_000);
    expect(sent.flat()).toEqual([
      { source: 'ConsoleError', message: 'same', stack: 'at f', repeats: 50 },
      { source: 'ConsoleError', message: 'other', stack: null, repeats: 1 },
    ]);
  });

  it('never holds an extension\'s line, so it spends none of the window', () => {
    const { clock, buffer, sent } = setup({ ...LIMITS, linesPerWindow: 1 });
    buffer.record(line('Uncaught TypeError', 'at n (chrome-extension://abc/Grammarly.js:2:1)'));
    buffer.record(line('the app\'s own'));
    clock.advance(5_000);
    expect(sent.flat().map((e) => e.message)).toEqual(['the app\'s own']);
  });

  it('discards what it holds when cleared, and sends nothing for it', () => {
    const { clock, buffer, sent } = setup();
    buffer.record(line('held'));
    buffer.clear();
    expect(buffer.held).toBe(0);
    clock.advance(10_000);
    expect(sent).toEqual([]);
  });
});
