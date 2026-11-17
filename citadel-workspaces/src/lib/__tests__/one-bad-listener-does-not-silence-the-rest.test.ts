import { describe, it, expect, vi } from 'vitest';
import type { Mock } from 'vitest';
import { notifyEach } from '../notify-listeners';

/**
 * The defect this guards is not "an error escapes" — it is that a subscriber
 * which has nothing to do with the failing one silently stops being told
 * anything. `forEach` propagates, so the first throw both aborts the fan-out
 * and unwinds into the caller that was succeeding.
 *
 * On the P2P path that reads as a message delivered to some listeners and not
 * others, with no error anywhere near the listener that dropped it.
 */
describe('notifyEach', () => {
  it('still notifies the listeners after one that throws', () => {
    const before: Mock<(value: string) => void> = vi.fn();
    const after: Mock<(value: string) => void> = vi.fn();
    const listeners: Array<(value: string) => void> = [
      before,
      (): void => {
        throw new Error('this subscriber is broken');
      },
      after,
    ];

    notifyEach(listeners, 'test', 'payload');

    expect(before).toHaveBeenCalledWith('payload');
    expect(after).toHaveBeenCalledWith('payload');
  });

  it('does not unwind into the caller that triggered the notification', () => {
    const listeners: Array<(value: string) => void> = [
      (): void => {
        throw new Error('this subscriber is broken');
      },
    ];

    // The caller here stands in for login()/an inbound message handler: it was
    // succeeding, and a subscriber's bug must not turn that into a failure.
    expect((): void => notifyEach(listeners, 'test', 'payload')).not.toThrow();
  });

  it('passes every argument through, not just the first', () => {
    const listener: Mock<(cid: bigint, flag: boolean) => void> = vi.fn();

    notifyEach([listener], 'test', 1n, true);

    expect(listener).toHaveBeenCalledWith(1n, true);
  });

  it('accepts a Set, which is what every call site actually holds', () => {
    const seen: string[] = [];
    const listeners: Set<(value: string) => void> = new Set<(value: string) => void>([
      (v: string): void => {
        seen.push(`a:${v}`);
      },
      (): void => {
        throw new Error('broken');
      },
      (v: string): void => {
        seen.push(`b:${v}`);
      },
    ]);

    notifyEach(listeners, 'test', 'x');

    expect(seen).toEqual(['a:x', 'b:x']);
  });
});
