/**
 * Moving an admin's asks into the Scratchpad: only what was written is acknowledged, so a note
 * that fails to write is taken again next time; a device whose agent keeps no notes takes nothing.
 */
import { describe, expect, it } from 'vitest';
import type { AdminRequestEntry } from 'citadel-workspace-client-ts';
import { deliverPending, type DeliverDeps } from '../deliver';
import { askSentence, noteFor } from '../words';

const entry = (id: string): AdminRequestEntry => ({ id, from_user: 'alice', at_ms: 1_700_000_000_000n, text: `ask ${id}` });

type Recorded = DeliverDeps & { notes: string[]; acked: string[][]; took: number };

function deps(entries: AdminRequestEntry[], keeps: boolean, failOn: string | null): Recorded {
  const state: { notes: string[]; acked: string[][]; took: number } = { notes: [], acked: [], took: 0 };
  return Object.assign(state, {
    keepsNotes: async (): Promise<boolean> => keeps,
    take: async (): Promise<AdminRequestEntry[]> => { state.took += 1; return entries; },
    writeNote: async (e: AdminRequestEntry): Promise<void> => {
      if (e.id === failOn) throw new Error('send failed');
      state.notes.push(e.id);
    },
    ack: async (ids: string[]): Promise<number> => { state.acked.push(ids); return ids.length; },
  });
}

describe('deliverPending', () => {
  it('writes every ask, then acknowledges exactly those', async () => {
    const d: Recorded = deps([entry('1'), entry('2')], true, null);
    expect(await deliverPending(d)).toBe(2);
    expect(d.notes).toEqual(['1', '2']);
    expect(d.acked).toEqual([['1', '2']]);
  });

  it('a failed write: the ones before it are acknowledged, it and the rest are not, and the failure surfaces', async () => {
    const d: Recorded = deps([entry('1'), entry('2'), entry('3')], true, '2');
    await expect(deliverPending(d)).rejects.toThrow('send failed');
    expect(d.acked).toEqual([['1']]);
  });

  it('nothing written: no ack is sent', async () => {
    const d: Recorded = deps([entry('1')], true, '1');
    await expect(deliverPending(d)).rejects.toThrow();
    expect(d.acked).toEqual([]);
  });

  it('an agent that keeps no notes: nothing is taken, so the asks wait on the server', async () => {
    const d: Recorded = deps([entry('1')], false, null);
    expect(await deliverPending(d)).toBe(0);
    expect(d.took).toBe(0);
  });
});

describe('the words', () => {
  it('the note names who asked, when, and what', () => {
    expect(noteFor(entry('1'), (ms: bigint): string => `t${ms}`)).toBe('Request from @alice · t1700000000000\nask 1');
  });
  it('the ask sentence quotes the thing asked about', () => {
    expect(askSentence('permission', 'Edit rooms')).toBe('Asks for the permission “Edit rooms”.');
  });
});
