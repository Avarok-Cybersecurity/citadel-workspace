/**
 * Pausing a contact drops the live link and nothing else.
 *
 * The owner's decision: "Pause" is not a block and not a deregistration. The
 * peer stays a contact, messages wait in the ILM, and they go out after
 * Resume. Because auto-connect redials within seconds, the pause has to be a
 * stored fact this browser consults before every dial and every incoming
 * accept -- per (our session, their session), surviving a reload.
 *
 * Real: the store, its key scheme, the status decoding, the dial/answer rules.
 * Stood in: the agent's LocalDB (a WebSocket round trip to the local agent),
 * by a Map that keeps the one contract that matters here -- an absent key is a
 * REJECTION saying "Key not found", exactly as the agent answers, and a failed
 * read is a rejection saying something else. And the P2P link, by a recorder,
 * because there is no peer on the other end of a unit test.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { PeerPauseStore, type PauseStorage, type PauseLink } from '../pause-store';
import { mayDial, answerFor, type PauseStatus } from '../pause-rules';

const ALICE: bigint = 7610457994796114930n;
const BOB: bigint = 14741090851496596846n;
const CAROL: bigint = 300n;

class AgentLocalDB implements PauseStorage {
  readonly rows: Map<string, number[]> = new Map();
  failReads: boolean = false;
  failWrites: boolean = false;

  private row(cid: bigint, key: string): string { return `${cid.toString()}/${key}`; }

  async get(cid: bigint, key: string): Promise<{ value: number[] } | null> {
    if (this.failReads) throw new Error('LocalDB request timed out after 5000ms');
    const value: number[] | undefined = this.rows.get(this.row(cid, key));
    if (value === undefined) throw new Error(`Key not found: ${key}`);
    return { value };
  }

  async set(cid: bigint, key: string, value: number[]): Promise<void> {
    if (this.failWrites) throw new Error('LocalDB request timed out after 5000ms');
    this.rows.set(this.row(cid, key), value);
  }

  async remove(cid: bigint, key: string): Promise<void> {
    if (this.failWrites) throw new Error('LocalDB request timed out after 5000ms');
    this.rows.delete(this.row(cid, key));
  }
}

class LinkRecorder implements PauseLink {
  readonly dropped: Array<[bigint, bigint]> = [];
  readonly reconnected: bigint[] = [];
  connected: boolean = true;
  failDrop: boolean = false;

  isConnected(_localCid: bigint, _peerCid: bigint): boolean { return this.connected; }

  async drop(localCid: bigint, peerCid: bigint): Promise<void> {
    if (this.failDrop) throw new Error('PeerDisconnect failed');
    this.dropped.push([localCid, peerCid]);
  }

  async reconnect(peerCid: bigint): Promise<void> { this.reconnected.push(peerCid); this.order.push('reconnect'); }

  readonly order: string[] = [];
  async flushHeld(_localCid: bigint, _peerCid: bigint): Promise<number> { this.order.push('flush'); return 0; }
}

describe('pausing a contact', () => {
  let db: AgentLocalDB;
  let link: LinkRecorder;
  let store: PeerPauseStore;

  beforeEach((): void => {
    db = new AgentLocalDB();
    link = new LinkRecorder();
    store = new PeerPauseStore({ storage: db, link });
  });

  it('is not paused before anyone chose to pause', async (): Promise<void> => {
    expect(await store.status(ALICE, BOB)).toBe('active');
  });

  it('records the pause for exactly that pair of sessions', async (): Promise<void> => {
    await store.pause(ALICE, BOB);
    expect(await store.status(ALICE, BOB)).toBe('paused');
    expect(await store.status(ALICE, CAROL), 'another contact of the same session').toBe('active');
    expect(await store.status(CAROL, BOB), 'another session in this browser').toBe('active');
  });

  it('drops the live connection, and does not deregister or block', async (): Promise<void> => {
    await store.pause(ALICE, BOB);
    expect(link.dropped).toEqual([[ALICE, BOB]]);
    expect(link.reconnected).toEqual([]);
  });

  it('does not send a disconnect for a link that is not up', async (): Promise<void> => {
    link.connected = false;
    await store.pause(ALICE, BOB);
    expect(link.dropped).toEqual([]);
    expect(await store.status(ALICE, BOB)).toBe('paused');
  });

  it('survives a reload: a fresh store over the same agent still sees it', async (): Promise<void> => {
    await store.pause(ALICE, BOB);
    const afterReload: PeerPauseStore = new PeerPauseStore({ storage: db, link: new LinkRecorder() });
    expect(await afterReload.status(ALICE, BOB)).toBe('paused');
  });

  it('resume clears the pause and reconnects', async (): Promise<void> => {
    await store.pause(ALICE, BOB);
    await store.resume(ALICE, BOB);
    expect(await store.status(ALICE, BOB)).toBe('active');
    expect(link.reconnected).toEqual([BOB]);
  });

  it('resume hands on what the pause held, then reconnects', async (): Promise<void> => {
    await store.pause(ALICE, BOB);
    await store.resume(ALICE, BOB);
    expect(link.order).toEqual(['flush', 'reconnect']);
  });

  it('does not drop the link when the pause could not be recorded', async (): Promise<void> => {
    // Dropping without the record would be undone by auto-connect in seconds,
    // while the user was told it had worked.
    db.failWrites = true;
    await expect(store.pause(ALICE, BOB)).rejects.toThrow(/timed out/);
    expect(link.dropped).toEqual([]);
  });

  it('reports a failed disconnect instead of claiming the link is down', async (): Promise<void> => {
    link.failDrop = true;
    await expect(store.pause(ALICE, BOB)).rejects.toThrow(/PeerDisconnect failed/);
    expect(await store.status(ALICE, BOB), 'the pause itself still holds').toBe('paused');
  });

  it('says it does not know when the read failed, rather than "not paused"', async (): Promise<void> => {
    await store.pause(ALICE, BOB);
    db.failReads = true;
    expect(await store.status(ALICE, BOB)).toBe('unknown');
  });

  it('tells subscribers what changed', async (): Promise<void> => {
    const seen: Array<{ localCid: bigint; peerCid: bigint; status: PauseStatus }> = [];
    const stop: () => void = store.subscribe((change): void => { seen.push(change); });
    await store.pause(ALICE, BOB);
    await store.resume(ALICE, BOB);
    stop();
    await store.pause(ALICE, CAROL);
    expect(seen).toEqual([
      { localCid: ALICE, peerCid: BOB, status: 'paused' },
      { localCid: ALICE, peerCid: BOB, status: 'active' },
    ]);
  });
});

describe('what a pause status permits', () => {
  it('dials only a peer known not to be paused', () => {
    expect(mayDial('active')).toBe(true);
    expect(mayDial('paused')).toBe(false);
    // An unreadable record must not undo the user's pause by accident; the
    // periodic poll asks again.
    expect(mayDial('unknown')).toBe(false);
  });

  it('declines a paused peer, ignores when unsure, accepts otherwise', () => {
    expect(answerFor('paused')).toBe('decline');
    expect(answerFor('unknown')).toBe('ignore');
    expect(answerFor('active')).toBe('accept');
  });
});
