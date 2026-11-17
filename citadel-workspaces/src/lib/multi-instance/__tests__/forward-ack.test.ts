/**
 * A cross-tab forward must not be able to vanish.
 *
 * It used to be a bare BroadcastChannel post: no ack, no retry, and
 * MessageNotification is not in LEADER_MUST_PROCESS_LOCALLY, so the leader kept
 * no copy. Three ways that lost a message — target tab mid-reload (the channel
 * does not queue for absent listeners), a tab whose P2P handler had not
 * subscribed yet, and a "ghost" instance that died without announcing it.
 *
 * The leader now retains every forward until the target acks. These cover the
 * retention lifecycle; the ack must both release the copy AND cancel the
 * fallback, because either one alone is a bug: a leaked entry leaks a timer,
 * and an uncancelled timer delivers the message twice.
 */
import { describe, it, expect, vi, beforeEach, afterEach  } from 'vitest';
import { OrphanBuffer } from '../orphan-buffer';

const MSG: Record<string, unknown> = { MessageNotification: { cid: 1, peer_cid: 2 } } as Record<string, unknown>;

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('forward retention and ack', () => {
  it('an ack cancels the fallback, so the message is not also processed locally', () => {
    const fallback: ReturnType<typeof vi.fn> = vi.fn();
    const buffer: OrphanBuffer = new OrphanBuffer(fallback, 2000);

    buffer.push('cid-1', MSG, 'MessageNotification', {
      requestId: 'req-1',
      targetInstanceId: 'tab-b',
      fanOut: ['tab-b'],
    });
    expect(buffer.ack('req-1')).toBe(true);

    vi.advanceTimersByTime(5000);
    // Without the timer being cleared, the leader would deliver a second copy
    // of a message the target already handled.
    expect(fallback).not.toHaveBeenCalled();
  });

  it('no ack means the leader falls back and names the unresponsive tab', () => {
    const fallback: ReturnType<typeof vi.fn> = vi.fn();
    const buffer: OrphanBuffer = new OrphanBuffer(fallback, 2000);

    buffer.push('cid-1', MSG, 'MessageNotification', {
      requestId: 'req-1',
      targetInstanceId: 'ghost-tab',
      fanOut: ['ghost-tab'],
    });
    vi.advanceTimersByTime(2001);

    // The instance id is what lets the router unregister a ghost; without it
    // every later message to that CID pays the same timeout again.
    expect(fallback).toHaveBeenCalledWith(MSG, 'MessageNotification', 'ghost-tab', ['ghost-tab']);
  });

  it('an unknown or repeated ack is a harmless no-op', () => {
    const fallback: ReturnType<typeof vi.fn> = vi.fn();
    const buffer: OrphanBuffer = new OrphanBuffer(fallback, 2000);

    buffer.push('cid-1', MSG, 'MessageNotification', {
      requestId: 'req-1',
      targetInstanceId: 'tab-b',
      fanOut: ['tab-b'],
    });

    // Every tab sees the ack event; only the leader holds entries, so misses
    // are normal traffic rather than an error.
    expect(buffer.ack('never-sent')).toBe(false);
    expect(buffer.ack('req-1')).toBe(true);
    expect(buffer.ack('req-1')).toBe(false);
  });

  it('acking one forward leaves another for the same CID pending', () => {
    const fallback: ReturnType<typeof vi.fn> = vi.fn();
    const buffer: OrphanBuffer = new OrphanBuffer(fallback, 2000);

    buffer.push('cid-1', MSG, 'A', { requestId: 'req-1', targetInstanceId: 'tab-b', fanOut: ['tab-b'] });
    buffer.push('cid-1', MSG, 'B', { requestId: 'req-2', targetInstanceId: 'tab-b', fanOut: ['tab-b'] });

    buffer.ack('req-1');
    vi.advanceTimersByTime(2001);

    // A burst to one tab shares a CID bucket; releasing one entry must not
    // release its neighbours.
    expect(fallback).toHaveBeenCalledTimes(1);
    expect(fallback).toHaveBeenCalledWith(MSG, 'B', 'tab-b', ['tab-b']);
  });

  it('orphan pushes with no forward context still work unchanged', () => {
    const fallback: ReturnType<typeof vi.fn> = vi.fn();
    const buffer: OrphanBuffer = new OrphanBuffer(fallback, 2000);

    buffer.push('cid-1', MSG, 'MessageNotification');
    vi.advanceTimersByTime(2001);

    expect(fallback).toHaveBeenCalledWith(MSG, 'MessageNotification', undefined, undefined);
  });
});
