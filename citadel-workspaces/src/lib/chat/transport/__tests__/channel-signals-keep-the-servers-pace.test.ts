/**
 * The reader's read cursor and typing go out paced below the server's limits (1 s per cursor,
 * 3 s per typing notice), because a refusal is an `Error` response that a concurrent send would
 * take as its own answer: a cursor sent too soon could mark a delivered message as failed.
 *
 * MOCKS, and why: the clock is the manual clock the document session's pacing tests use, so time
 * moves only when the test says; the write and send functions are recorders standing in for the
 * request port, which the pane-level tests run for real.
 */
import { describe, it, expect } from 'vitest';
import { ManualClock } from '@/lib/cdoc/collab/__tests__/doubles/manual-clock';
import { readCursor, READ_CURSOR_GAP_MS, type ReadCursor } from '../node-read-cursor';
import { nodeStatus, TYPING_SEND_GAP_MS, TYPING_SHOWN_MS } from '../node-status';
import type { StatusChange, StatusPort } from '../chat-transport';

function cursorWith(clock: ManualClock, newest: { id: string | null }, receipts: { on: boolean }, writes: string[], fail: { next: boolean }): ReadCursor {
  return readCursor({
    clock, newest: (): string | null => newest.id, held: (): null => null, sendsReceipts: (): boolean => receipts.on,
    write: async (upto: string): Promise<void> => {
      writes.push(upto);
      if (fail.next) { fail.next = false; throw new Error('Read receipts are kept at most once a second'); }
    },
    report: (): void => undefined,
  });
}

describe('the read cursor', () => {
  it('folds reads inside the gap into one trailing write of the newest message', async () => {
    const clock: ManualClock = new ManualClock();
    const newest: { id: string | null; } = { id: 'm1' as string | null };
    const writes: string[] = [];
    const cursor: ReadCursor = cursorWith(clock, newest, { on: true }, writes, { next: false });
    cursor.read();
    await new Promise((resolve) => setTimeout(resolve, 0)); // the first write is answered
    newest.id = 'm2'; cursor.read();
    newest.id = 'm3'; cursor.read();
    expect(writes).toEqual(['m1']);
    clock.advance(READ_CURSOR_GAP_MS - 1);
    expect(writes).toEqual(['m1']);
    clock.advance(1);
    expect(writes).toEqual(['m1', 'm3']);
  });

  it('writes nothing for a reader who sends no receipts', () => {
    const writes: string[] = [];
    cursorWith(new ManualClock(), { id: 'm1' }, { on: false }, writes, { next: false }).read();
    expect(writes).toEqual([]);
  });

  it('forgets a refused write, so the next read sends it again', async () => {
    const clock: ManualClock = new ManualClock();
    const writes: string[] = [];
    const cursor: ReadCursor = cursorWith(clock, { id: 'm1' }, { on: true }, writes, { next: true });
    cursor.read();
    await new Promise((resolve) => setTimeout(resolve, 0));
    clock.advance(READ_CURSOR_GAP_MS);
    cursor.read();
    expect(writes).toEqual(['m1', 'm1']);
  });
});

function typingWith(clock: ManualClock, sent: number[], shows: { on: boolean }): { port: StatusPort; heard: (m: string) => void; wrote: (m: string) => void; seen: string[][] } {
  const hooks: { heard: (_m: string) => void; wrote: (_m: string) => void; } = { heard: (_m: string): void => undefined, wrote: (_m: string): void => undefined };
  const port: StatusPort = nodeStatus({
    clock, sendTyping: (): void => { sent.push(clock.now()); }, showsTyping: (): boolean => shows.on, selfUsername: 'ada',
    nameOf: (member: string): string => member.toUpperCase(),
    listen: (heard, wrote): (() => void) => { hooks.heard = heard; hooks.wrote = wrote; return (): void => undefined; },
  });
  const seen: string[][] = [];
  port.subscribe((change: StatusChange): void => { if (change.kind === 'typing') seen.push([...change.typing]); });
  return { port, heard: (m: string): void => hooks.heard(m), wrote: (m: string): void => hooks.wrote(m), seen };
}

describe('typing in a node channel', () => {
  it('says the reader is typing at most once per gap, and not for a draft left untouched', () => {
    const clock: ManualClock = new ManualClock();
    const sent: number[] = [];
    const { port } = typingWith(clock, sent, { on: true });
    let text: string = 'a draft';
    port.startTyping((): string => text);
    clock.advance(3_000);
    expect(sent).toEqual([]);
    for (let i: number = 0; i < 10; i += 1) { text += 'x'; clock.advance(1_000); }
    expect(sent.length).toBe(Math.ceil(10_000 / TYPING_SEND_GAP_MS));
    expect(sent[1] - sent[0]).toBeGreaterThanOrEqual(TYPING_SEND_GAP_MS);
    port.stopTyping();
    expect(clock.pending).toBe(0);
  });

  it('sends nothing for a reader who hides their typing', () => {
    const clock: ManualClock = new ManualClock();
    const sent: number[] = [];
    const { port } = typingWith(clock, sent, { on: false });
    let text: string = '';
    port.startTyping((): string => text);
    for (let i: number = 0; i < 6; i += 1) { text += 'x'; clock.advance(1_000); }
    expect(sent).toEqual([]);
  });

  it('names a member until their notices stop or their message lands, never the reader', () => {
    const clock: ManualClock = new ManualClock();
    const { heard, wrote, seen } = typingWith(clock, [], { on: true });
    heard('ada');
    heard('bob');
    heard('cy');
    expect(seen.at(-1)).toEqual(['BOB', 'CY']);
    clock.advance(TYPING_SHOWN_MS - 1);
    heard('bob');
    clock.advance(1);
    expect(seen.at(-1)).toEqual(['BOB']);
    wrote('bob');
    expect(seen.at(-1)).toEqual([]);
  });
});
