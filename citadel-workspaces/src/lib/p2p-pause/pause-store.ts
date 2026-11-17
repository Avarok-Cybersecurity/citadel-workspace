/**
 * Pausing and resuming a contact's connection.
 *
 * Pause = record it, then drop the live link. Resume = clear it, then dial.
 * Nothing is deregistered and nothing is blocked: the contact stays, and the
 * ILM holds what is sent meanwhile until the link is back.
 *
 * No cache. The agent's LocalDB is the one record, and every tab of this
 * browser -- the leader that dials, the follower that owns the session -- reads
 * it directly, so a pause made in one tab cannot be missed by another holding
 * a stale copy.
 *
 * I/O arrives through the two ports below; `index.ts` wires the real ones.
 */
import { TypedEventEmitter } from '@/lib/event-emitter';
import { stringToBytes } from '@/lib/utils/encoding-utils';
import {
  pauseKey, statusFromStored, statusFromReadError, PAUSED_MARKER, type PauseStatus,
} from './pause-rules';

/** The agent's per-session LocalDB. `get` rejects "Key not found" when absent. */
export interface PauseStorage {
  get(localCid: bigint, key: string): Promise<{ value: number[] } | null>;
  set(localCid: bigint, key: string, value: number[]): Promise<void>;
  remove(localCid: bigint, key: string): Promise<void>;
}

/** The live P2P link, as auto-connect knows it. */
export interface PauseLink {
  isConnected(localCid: bigint, peerCid: bigint): boolean;
  drop(localCid: bigint, peerCid: bigint): Promise<void>;
  reconnect(peerCid: bigint): Promise<void>;
  /** Hand the paused-contact outbox to the ILM; returns how many went. */
  flushHeld(localCid: bigint, peerCid: bigint): Promise<number>;
}

export interface PauseChange {
  localCid: bigint;
  peerCid: bigint;
  status: PauseStatus;
}

export async function readPauseStatus(storage: PauseStorage, localCid: bigint, peerCid: bigint): Promise<PauseStatus> {
  try {
    return statusFromStored(await storage.get(localCid, pauseKey(peerCid)));
  } catch (error: unknown) {
    return statusFromReadError(error);
  }
}

export class PeerPauseStore {
  private readonly storage: PauseStorage;
  private readonly link: PauseLink;
  private readonly changes: TypedEventEmitter<PauseChange> = new TypedEventEmitter<PauseChange>();

  constructor(deps: { storage: PauseStorage; link: PauseLink }) {
    this.storage = deps.storage;
    this.link = deps.link;
  }

  status(localCid: bigint, peerCid: bigint): Promise<PauseStatus> {
    return readPauseStatus(this.storage, localCid, peerCid);
  }

  /**
   * Recorded BEFORE the drop: a drop without the record is undone by
   * auto-connect within seconds. A failed drop is rethrown -- the pause holds,
   * but the caller must not be told the link is down when it may not be.
   */
  async pause(localCid: bigint, peerCid: bigint): Promise<void> {
    await this.storage.set(localCid, pauseKey(peerCid), stringToBytes(PAUSED_MARKER));
    this.changes.emit({ localCid, peerCid, status: 'paused' });
    if (this.link.isConnected(localCid, peerCid)) {
      await this.link.drop(localCid, peerCid);
    }
  }

  /**
   * Cleared BEFORE the dial, or the dial would be refused by the pause gate.
   * The held messages go to the ILM before the dial too: it queues them until
   * the link is up, so they leave in order ahead of anything sent after.
   */
  async resume(localCid: bigint, peerCid: bigint): Promise<void> {
    await this.storage.remove(localCid, pauseKey(peerCid));
    this.changes.emit({ localCid, peerCid, status: 'active' });
    await this.link.flushHeld(localCid, peerCid);
    await this.link.reconnect(peerCid);
  }

  subscribe(onChange: (change: PauseChange) => void): () => void {
    return this.changes.subscribe(onChange);
  }
}
