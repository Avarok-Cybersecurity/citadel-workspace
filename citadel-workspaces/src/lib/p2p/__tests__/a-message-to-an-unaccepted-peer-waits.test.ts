/**
 * A message to someone who has not accepted your request waits, and leaves once they do.
 *
 * Owner, 2026-10-16: the composer refused to send before registration -- "it makes sense, but
 * ... it's unsavory". So the message is held in the one held outbox, reason `'unregistered'`,
 * and flushed through the normal send exactly once, in order, when registration completes.
 *
 * Real: the held outbox and its key format, the hold and flush, the CBOR command the message
 * id is read back from, and the cross-tab lock's in-tab stand-in (serial-queue). Stood in: the
 * agent's LocalDB (a Map that rejects absent keys as the agent does), the wire send, and the
 * registry's answer, which need a live agent.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { HeldOutbox, type OutboxStorage } from '@/lib/p2p-pause/outbox';
import { pauseKey, PAUSED_MARKER } from '@/lib/p2p-pause/pause-rules';
import { stringToBytes } from '@/lib/utils/encoding-utils';
import { withSerialLock } from '@/lib/serial-queue';
import { createMessagingLayerCommand, deserializeP2PCommand, serializeP2PCommand, type P2PMessagingLayerPayload } from '@/types/p2p-commands';
import { createMessage } from '@/types/messaging-layer';
import { holdUntilRegistered, flushOnceRegistered, type RegistrationHoldDeps } from '../held-until-registered';

const ME: bigint = 9399548604789644783n;
const BOB: bigint = 15630987608599047565n;

class AgentLocalDB implements OutboxStorage {
  readonly rows: Map<string, number[]> = new Map();
  async get(_cid: bigint, key: string): Promise<{ value: number[] } | null> {
    const value: number[] | undefined = this.rows.get(key);
    if (value === undefined) throw new Error(`Key not found: ${key}`);
    return { value };
  }
  async set(_cid: bigint, key: string, value: number[]): Promise<void> { this.rows.set(key, value); }
  async remove(_cid: bigint, key: string): Promise<void> { this.rows.delete(key); }
  async listKeys(_cid: bigint, prefix: string): Promise<string[]> {
    const keys: string[] = [...this.rows.keys()].filter((k: string): boolean => k.startsWith(prefix));
    if (keys.length === 0) throw new Error(`No keys found with prefix ${prefix}`);
    return keys;
  }
}

function messageBytes(id: string): Uint8Array {
  return serializeP2PCommand(createMessagingLayerCommand(createMessage(`text of ${id}`, 1), ME, BOB, 0, { messageId: id }));
}

function idOf(bytes: Uint8Array): string {
  return (deserializeP2PCommand(bytes).payload as P2PMessagingLayerPayload).message_id;
}

interface Rig { deps: RegistrationHoldDeps; outbox: HeldOutbox; db: AgentLocalDB; sent: string[]; marked: string[]; accept: () => void; failSends: (fail: boolean) => void }

function rig(db: AgentLocalDB = new AgentLocalDB(), start: number = 1_000): Rig {
  let clock: number = start;
  let registered: boolean = false;
  let failing: boolean = false;
  const sent: string[] = [];
  const marked: string[] = [];
  const outbox: HeldOutbox = new HeldOutbox({ storage: db, now: (): number => clock++ });
  const deps: RegistrationHoldDeps = {
    outbox,
    isRegistered: (peer: bigint): boolean => peer === BOB && registered,
    send: async (_local: bigint, _peer: bigint, bytes: Uint8Array): Promise<void> => {
      // A turn of the event loop, as the real send takes: a second flush has every chance to overlap.
      await new Promise<void>((resolve: () => void): void => { setTimeout(resolve, 0); });
      if (failing) throw new Error('peer unreachable');
      sent.push(idOf(bytes));
    },
    markSent: async (_peer: bigint, id: string): Promise<void> => { marked.push(id); },
    exclusive: withSerialLock,
  };
  return { deps, outbox, db, sent, marked, accept: (): void => { registered = true; }, failSends: (f: boolean): void => { failing = f; } };
}

describe('a message to someone who has not accepted', () => {
  let r: Rig;
  beforeEach((): void => { r = rig(); });

  const hold = (id: string): Promise<void> => holdUntilRegistered(r.deps, ME, BOB, messageBytes(id), 'cbor-command');

  it('is held, not sent, while they have not accepted', async (): Promise<void> => {
    await hold('a');
    await hold('b');
    expect(await flushOnceRegistered(r.deps, ME, BOB)).toBe(0);
    expect(r.sent).toEqual([]);
    expect(await r.outbox.heldCount(ME, BOB, 'unregistered')).toBe(2);
  });

  it('leaves once they accept: in order, each exactly once, and is marked sent', async (): Promise<void> => {
    for (const id of ['a', 'b', 'c']) await hold(id);
    r.accept();
    // The registry's event and the open chat both ask at once; only one may send.
    const counts: number[] = await Promise.all([flushOnceRegistered(r.deps, ME, BOB), flushOnceRegistered(r.deps, ME, BOB)]);
    expect(r.sent).toEqual(['a', 'b', 'c']);
    expect(counts.reduce((x: number, y: number): number => x + y, 0)).toBe(3);
    expect(r.marked).toEqual(['a', 'b', 'c']);
    expect(await r.outbox.heldCount(ME, BOB, 'unregistered')).toBe(0);
  });

  it('survives a reload: a fresh outbox over the same agent still holds it, and flushes it', async (): Promise<void> => {
    await hold('before-reload');
    const afterReload: Rig = rig(r.db, 5_000);
    expect(await afterReload.outbox.heldCount(ME, BOB, 'unregistered')).toBe(1);
    afterReload.accept();
    expect(await flushOnceRegistered(afterReload.deps, ME, BOB)).toBe(1);
    expect(afterReload.sent).toEqual(['before-reload']);
  });

  it('is not lost when the request is declined or never answered: it stays held', async (): Promise<void> => {
    await hold('a');
    // Declined: registration never completes, so every flush is refused, however often asked.
    for (let i: number = 0; i < 3; i += 1) expect(await flushOnceRegistered(r.deps, ME, BOB)).toBe(0);
    expect(await r.outbox.heldCount(ME, BOB, 'unregistered')).toBe(1);
  });

  it('is not lost when the send after acceptance fails: it stays held, unmarked, and goes next time', async (): Promise<void> => {
    await hold('a');
    await hold('b');
    r.accept();
    r.failSends(true);
    await expect(flushOnceRegistered(r.deps, ME, BOB)).rejects.toThrow(/unreachable/);
    expect(r.marked).toEqual([]);
    expect(await r.outbox.heldCount(ME, BOB, 'unregistered')).toBe(2);
    r.failSends(false);
    expect(await flushOnceRegistered(r.deps, ME, BOB)).toBe(2);
    expect(r.sent).toEqual(['a', 'b']);
  });
});

describe('one outbox, two reasons', () => {
  it('Resume does not release what waits for acceptance, nor acceptance what waits on a pause', async (): Promise<void> => {
    const r: Rig = rig();
    await holdUntilRegistered(r.deps, ME, BOB, messageBytes('waits-for-accept'), undefined);
    r.db.rows.set(pauseKey(BOB), stringToBytes(PAUSED_MARKER));
    await r.outbox.sendOrHold(ME, BOB, messageBytes('waits-for-resume'), {}, async (): Promise<void> => { throw new Error('paused: must not send'); });

    const resumed: string[] = [];
    await r.outbox.flush(ME, BOB, 'paused', async (b: Uint8Array): Promise<void> => { resumed.push(idOf(b)); });
    expect(resumed).toEqual(['waits-for-resume']);

    r.accept();
    await flushOnceRegistered(r.deps, ME, BOB);
    expect(r.sent).toEqual(['waits-for-accept']);
  });
});
