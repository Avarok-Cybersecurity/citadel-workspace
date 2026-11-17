/**
 * Exactly one window runs a member's Calendar work at a time (runner-lock.ts, use-held-lock.ts):
 * the second window waits; when the first closes, the second takes over; another member's window
 * runs their own alongside. The lock is a stand-in with the Web Locks contract (one holder per
 * name, waiters served in order, an aborted wait never granted), since jsdom has no Web Locks.
 */
import { describe, expect, it } from 'vitest';
import { act, render, screen, type RenderResult } from '@testing-library/react';
import { runnerLockName, type RunnerLock } from '@/lib/calendar/runner-lock';
import { useHeldLock } from '../use-held-lock';

function fakeLocks(): RunnerLock {
  const held: Set<string> = new Set();
  const waiting: Map<string, { grant: (release: () => void) => void; signal: AbortSignal }[]> = new Map();
  const next = (name: string): void => {
    const queue: { grant: (release: () => void) => void; signal: AbortSignal; }[] = (waiting.get(name) ?? []).filter((w) => !w.signal.aborted);
    const first: { grant: (release: () => void) => void; signal: AbortSignal; } | undefined = queue.shift();
    waiting.set(name, queue);
    if (first === undefined) return;
    held.add(name);
    first.grant(() => { held.delete(name); next(name); });
  };
  return {
    hold: (name: string, signal: AbortSignal): Promise<() => void> => new Promise((grant, refuse) => {
      signal.addEventListener('abort', () => refuse(new Error('aborted')));
      waiting.set(name, [...(waiting.get(name) ?? []), { grant, signal }]);
      if (!held.has(name)) next(name);
    }),
  };
}

function Window({ lock, member, id }: { lock: RunnerLock; member: string; id: string }): JSX.Element {
  const runs: boolean = useHeldLock(lock, runnerLockName(member));
  return <p data-testid={id}>{runs ? 'runs' : 'waits'}</p>;
}

const flush = (): Promise<void> => act(async () => { for (let i: number = 0; i < 5; i += 1) await Promise.resolve(); });

describe("a member's Calendar work", () => {
  it('runs in one window, moves to the next when it closes, and runs per member', async () => {
    const lock: RunnerLock = fakeLocks();
    const first: RenderResult = render(<Window lock={lock} member="ana" id="a1" />);
    render(<Window lock={lock} member="ana" id="a2" />);
    render(<Window lock={lock} member="bo" id="b1" />);
    await flush();
    expect([screen.getByTestId('a1').textContent, screen.getByTestId('a2').textContent, screen.getByTestId('b1').textContent]).toEqual(['runs', 'waits', 'runs']);
    first.unmount();
    await flush();
    expect(screen.getByTestId('a2').textContent).toBe('runs');
  });
});
