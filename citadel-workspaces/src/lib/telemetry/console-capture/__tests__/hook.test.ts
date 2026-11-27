/**
 * Two hooks stacked on one console (the bug reporter's ring under telemetry's capture): undoing the
 * lower one while the upper still wraps it leaves the upper in place and silences the lower.
 */
import { describe, expect, it } from 'vitest';
import { hookConsole, type ConsoleTarget } from '../hook';
import type { ConsoleLevel } from '../format';

type Heard = { level: ConsoleLevel; args: readonly unknown[] }[];

function fakeConsole(): { target: ConsoleTarget; printed: unknown[][] } {
  const printed: unknown[][] = [];
  return { printed, target: { error: (...args: unknown[]): void => { printed.push(args); }, warn: (): void => undefined } };
}

describe('hookConsole', () => {
  it('an undone hook under another stays in the chain silently; the upper one is untouched', () => {
    const { target, printed } = fakeConsole();
    const lower: Heard = [];
    const upper: Heard = [];
    const undoLower: () => void = hookConsole(target, (level: ConsoleLevel, args: readonly unknown[]): void => { lower.push({ level, args }); }, (): void => undefined);
    hookConsole(target, (level: ConsoleLevel, args: readonly unknown[]): void => { upper.push({ level, args }); }, (): void => undefined);
    const upperWrapper: ConsoleTarget['error'] = target.error;
    undoLower();
    expect(target.error).toBe(upperWrapper);
    target.error('boom');
    expect(printed).toEqual([['boom']]);
    expect(upper).toHaveLength(1);
    expect(lower).toHaveLength(0);
  });

  it('undone on top: the original methods come back', () => {
    const { target } = fakeConsole();
    const original: ConsoleTarget['error'] = target.error;
    const undo: () => void = hookConsole(target, (): void => undefined, (): void => undefined);
    expect(target.error).not.toBe(original);
    undo();
    expect(target.error).toBe(original);
  });
});
