/**
 * Merging by id, and the two opposite answers that shared a name.
 */

import { describe, it, expect } from 'vitest';
import { mergeById } from '../merge-by-id';

const msg: (id: string, timestamp: number, text?: string) => { id: string; timestamp: number; text: string; } = (id: string, timestamp: number, text = ''): { id: string; timestamp: number; text: string; } => ({ id, timestamp, text });

describe('mergeById', () => {
  it('keeps the existing copy when existing wins', () => {
    const merged: { id: string; timestamp: number; text: string; }[] = mergeById([msg('a', 1, 'old')], [msg('a', 1, 'new')], 'existing');
    expect(merged[0].text).toBe('old');
  });

  it('takes the incoming copy when incoming wins', () => {
    // The adapter's direction: in-memory state is newer than storage.
    const merged: { id: string; timestamp: number; text: string; }[] = mergeById([msg('a', 1, 'stored')], [msg('a', 1, 'live')], 'incoming');
    expect(merged[0].text).toBe('live');
  });

  it('returns the same array reference when existing wins and nothing is new', () => {
    // Load-bearing: React re-renders on reference inequality, and without this
    // a chat thread re-sorts on every keystroke.
    const existing: { id: string; timestamp: number; text: string; }[] = [msg('a', 1)];
    expect(mergeById(existing, [msg('a', 1)], 'existing')).toBe(existing);
  });

  it('does not return the same reference when something new arrived', () => {
    const existing: { id: string; timestamp: number; text: string; }[] = [msg('a', 1)];
    expect(mergeById(existing, [msg('b', 2)], 'existing')).not.toBe(existing);
  });

  it('sorts by timestamp in both directions', () => {
    for (const winner of ['existing', 'incoming'] as const) {
      const merged: { id: string; timestamp: number; text: string; }[] = mergeById([msg('c', 3)], [msg('a', 1), msg('b', 2)], winner);
      expect(merged.map((m) => m.id), winner).toEqual(['a', 'b', 'c']);
    }
  });

  it('merges into an empty list without aliasing the input', () => {
    const incoming: { id: string; timestamp: number; text: string; }[] = [msg('a', 1)];
    const merged: { id: string; timestamp: number; text: string; }[] = mergeById([], incoming, 'existing');
    expect(merged).toEqual(incoming);
    expect(merged).not.toBe(incoming);
  });

  it('deduplicates within the incoming list too', () => {
    // Two deliveries of the same message in one batch is a real shape when a
    // reconnect replays a queue.
    const merged: { id: string; timestamp: number; text: string; }[] = mergeById([], [msg('a', 1, 'first'), msg('a', 1, 'second')], 'incoming');
    expect(merged).toHaveLength(1);
  });
});
