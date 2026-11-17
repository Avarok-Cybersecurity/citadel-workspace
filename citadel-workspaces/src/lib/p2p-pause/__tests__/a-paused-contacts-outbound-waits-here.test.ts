/**
 * While a contact is paused, nothing addressed to them leaves this browser.
 *
 * Seen live: lara paused max, her ILM logged "Peer ... is not connected,
 * skipping" -- and the message was delivered anyway, read receipt and all. The
 * ILM's hold is only as good as its idea of "connected", which comes from this
 * app's connection state, and the link came back (the SDK auto-accepted max's
 * redial) and drained the queue. So the banner's promise -- "messages will be
 * delivered when you resume" -- is kept HERE, before any transport: a paused
 * contact's outbound goes into a durable outbox and leaves only on Resume.
 *
 * Real: the outbox, its key order and the pause read. Stood in: the agent's
 * LocalDB, by a Map with its absent-key rejection and its prefix listing.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { HeldOutbox, PausedPeerError, type OutboxStorage } from '../outbox';
import { pauseKey, PAUSED_MARKER } from '../pause-rules';
import { stringToBytes } from '@/lib/utils/encoding-utils';

const LARA: bigint = 9399548604789644783n;
const MAX: bigint = 15630987608599047565n;
const CAROL: bigint = 300n;

class AgentLocalDB implements OutboxStorage {
  readonly rows: Map<string, number[]> = new Map();
  failReads: boolean = false;
  private row(cid: bigint, key: string): string { return `${cid.toString()}/${key}`; }
  async get(cid: bigint, key: string): Promise<{ value: number[] } | null> {
    if (this.failReads) throw new Error('LocalDB request timed out after 5000ms');
    const value: number[] | undefined = this.rows.get(this.row(cid, key));
    if (value === undefined) throw new Error(`Key not found: ${key}`);
    return { value };
  }
  async set(cid: bigint, key: string, value: number[]): Promise<void> { this.rows.set(this.row(cid, key), value); }
  async remove(cid: bigint, key: string): Promise<void> { this.rows.delete(this.row(cid, key)); }
  async listKeys(cid: bigint, prefix: string): Promise<string[]> {
    const own: string = `${cid.toString()}/`;
    const keys: string[] = [...this.rows.keys()]
      .filter((k) => k.startsWith(own)).map((k) => k.slice(own.length)).filter((k) => k.startsWith(prefix));
    if (keys.length === 0) throw new Error(`No keys found with prefix ${prefix}`);
    return keys;
  }
}

function bytes(text: string): Uint8Array { return new TextEncoder().encode(text); }
function text(b: Uint8Array): string { return new TextDecoder().decode(b); }

describe('a send to a contact', () => {
  let db: AgentLocalDB;
  let clock: number;
  let outbox: HeldOutbox;
  const sent: string[] = [];
  const send = (b: Uint8Array): (() => Promise<void>) => async (): Promise<void> => { sent.push(text(b)); };

  beforeEach((): void => {
    db = new AgentLocalDB();
    clock = 1_000;
    outbox = new HeldOutbox({ storage: db, now: (): number => clock++ });
    sent.length = 0;
  });

  const pause = (local: bigint, peer: bigint): void => {
    db.rows.set(`${local.toString()}/${pauseKey(peer)}`, stringToBytes(PAUSED_MARKER));
  };

  it('goes straight out when the contact is not paused', async (): Promise<void> => {
    expect(await outbox.sendOrHold(LARA, MAX, bytes('hi'), {}, send(bytes('hi')))).toBe('sent');
    expect(sent).toEqual(['hi']);
  });

  it('is held, not sent, while the contact is paused', async (): Promise<void> => {
    pause(LARA, MAX);
    expect(await outbox.sendOrHold(LARA, MAX, bytes('hi'), {}, send(bytes('hi')))).toBe('held');
    expect(sent).toEqual([]);
  });

  it('is refused -- not sent, not held -- when the pause record cannot be read', async (): Promise<void> => {
    db.failReads = true;
    await expect(outbox.sendOrHold(LARA, MAX, bytes('hi'), {}, send(bytes('hi')))).rejects.toThrow(/could not check/i);
    db.failReads = false;
    expect(sent).toEqual([]);
    expect(await outbox.heldCount(LARA, MAX, 'paused')).toBe(0);
  });

  it('leaves on resume, in the order it was written, and only once', async (): Promise<void> => {
    pause(LARA, MAX);
    for (const m of ['one', 'two', 'three']) await outbox.sendOrHold(LARA, MAX, bytes(m), {}, send(bytes(m)));
    const flushed: string[] = [];
    await outbox.flush(LARA, MAX, 'paused', async (b: Uint8Array): Promise<void> => { flushed.push(text(b)); });
    expect(flushed).toEqual(['one', 'two', 'three']);
    expect(await outbox.heldCount(LARA, MAX, 'paused')).toBe(0);
  });

  it('leaves in write order even when every send lands in the same millisecond', async (): Promise<void> => {
    // The clock above never repeats, which hid this: keys ordered by time then a
    // random tiebreak put same-millisecond messages in random order. CI caught it
    // (2026-09-29): two sends from one test landed together and left as 2, 1.
    const frozen: HeldOutbox = new HeldOutbox({ storage: db, now: (): number => 1_000 });
    pause(LARA, MAX);
    const written: string[] = Array.from({ length: 12 }, (_: unknown, i: number): string => `m${i}`);
    for (const m of written) await frozen.sendOrHold(LARA, MAX, bytes(m), {}, send(bytes(m)));
    const flushed: string[] = [];
    await frozen.flush(LARA, MAX, 'paused', async (b: Uint8Array): Promise<void> => { flushed.push(text(b)); });
    expect(flushed).toEqual(written);
  });

  it('keeps what was not flushed when a flush fails part-way', async (): Promise<void> => {
    pause(LARA, MAX);
    for (const m of ['one', 'two', 'three']) await outbox.sendOrHold(LARA, MAX, bytes(m), {}, send(bytes(m)));
    const flushed: string[] = [];
    await expect(outbox.flush(LARA, MAX, 'paused', async (b: Uint8Array): Promise<void> => {
      if (text(b) === 'two') throw new Error('socket closed');
      flushed.push(text(b));
    })).rejects.toThrow(/socket closed/);
    expect(flushed).toEqual(['one']);
    expect(await outbox.heldCount(LARA, MAX, 'paused')).toBe(2);
  });

  it('belongs to one pair: another contact, another session are untouched', async (): Promise<void> => {
    pause(LARA, MAX);
    pause(LARA, CAROL);
    pause(CAROL, MAX);
    await outbox.sendOrHold(LARA, MAX, bytes('to max'), {}, send(bytes('to max')));
    await outbox.sendOrHold(LARA, CAROL, bytes('to carol'), {}, send(bytes('to carol')));
    await outbox.sendOrHold(CAROL, MAX, bytes('carol to max'), {}, send(bytes('carol to max')));
    const flushed: string[] = [];
    await outbox.flush(LARA, MAX, 'paused', async (b: Uint8Array): Promise<void> => { flushed.push(text(b)); });
    expect(flushed).toEqual(['to max']);
    expect(await outbox.heldCount(LARA, CAROL, 'paused')).toBe(1);
    expect(await outbox.heldCount(CAROL, MAX, 'paused')).toBe(1);
  });

  it('survives a reload: a fresh outbox over the same agent still holds it', async (): Promise<void> => {
    pause(LARA, MAX);
    await outbox.sendOrHold(LARA, MAX, bytes('before reload'), {}, send(bytes('before reload')));
    const afterReload: HeldOutbox = new HeldOutbox({ storage: db, now: (): number => 5_000 });
    const flushed: string[] = [];
    await afterReload.flush(LARA, MAX, 'paused', async (b: Uint8Array): Promise<void> => { flushed.push(text(b)); });
    expect(flushed).toEqual(['before reload']);
  });

  it('flushes nothing, without error, when nothing was held', async (): Promise<void> => {
    expect(await outbox.flush(LARA, MAX, 'paused', async (): Promise<void> => { throw new Error('should not send'); })).toBe(0);
  });
});

describe('a send that bypasses the ILM (live documents, call signalling)', () => {
  it('is refused while paused -- there is no queue behind it to wait in', async (): Promise<void> => {
    const db: AgentLocalDB = new AgentLocalDB();
    db.rows.set(`${LARA.toString()}/${pauseKey(MAX)}`, stringToBytes(PAUSED_MARKER));
    const outbox: HeldOutbox = new HeldOutbox({ storage: db, now: (): number => 1 });
    await expect(outbox.refuseIfPaused(LARA, MAX)).rejects.toBeInstanceOf(PausedPeerError);
    await expect(outbox.refuseIfPaused(LARA, CAROL)).resolves.toBeUndefined();
  });
});
