/**
 * A member's own stores have no announcer: the kernel announces writes to a node's stores only
 * (storage_notice.rs), and the agent's `local` store announces nothing. So the page announces what
 * an instance wrote to `user` or `local`, once the write is answered ok, to every instance of that
 * install acting for the same member: in this page (the writer included) and in this browser's
 * other windows and tabs, over one BroadcastChannel. As the kernel's notice, it names the store and
 * the keys, never a value: each instance reads the keys again through its own storage port.
 *
 * Pure over the channel it is handed (SBIO); the page opens the real one (page-runtime.ts).
 */
import type { OpArgs } from '../sdk/generated/AbiConstants';
import type { KvBackend } from '../sdk/generated/KvBackend';
import type { StorageChange, Unsubscribe } from '../host/glue-instance';
import type { PortAnswer, PortReply, StoragePort } from '../host/ports';

/** The stores only their member writes, which nobody else announces. */
export type OwnBackend = 'user' | 'local';

export interface OwnWrite {
  readonly installId: string;
  readonly backend: OwnBackend;
  readonly keys: readonly string[];
}

/** The member's own writes, announced and heard; bound to one member when made. */
export interface OwnWrites {
  readonly announce: (write: OwnWrite) => void;
  /** Each key another instance of `installId` wrote for this member, here or in another window. */
  readonly listen: (installId: string, listener: (change: StorageChange) => void) => Unsubscribe;
}

/** What the page's BroadcastChannel is to this module. */
export interface OwnWritesChannel {
  readonly postMessage: (message: unknown) => void;
  readonly onMessage: (listener: (message: unknown) => void) => void;
}

/** One write on the channel: the member it was written for travels with it, so another member's tab ignores it. */
interface OwnWriteMessage extends OwnWrite {
  readonly member: bigint;
}

const isOwnBackend = (b: unknown): b is OwnBackend => b === 'user' || b === 'local';

function readMessage(m: unknown): OwnWriteMessage | null {
  if (typeof m !== 'object' || m === null) return null;
  const { member, installId, backend, keys } = m as Record<string, unknown>;
  const ok: boolean = typeof member === 'bigint' && typeof installId === 'string' && isOwnBackend(backend)
    && Array.isArray(keys) && keys.every((k: unknown) => typeof k === 'string');
  return ok ? (m as OwnWriteMessage) : null;
}

/** `open` is called once, on first use: a page that never runs an app opens no channel. */
export function ownWrites(member: bigint, open: () => OwnWritesChannel): OwnWrites {
  const listeners: Set<(write: OwnWrite) => void> = new Set();
  const deliver = (write: OwnWrite): void => { for (const listener of [...listeners]) listener(write); };
  let channel: OwnWritesChannel | null = null;
  const opened = (): OwnWritesChannel => {
    if (channel !== null) return channel;
    const made: OwnWritesChannel = open();
    made.onMessage((m: unknown): void => {
      const write: OwnWriteMessage | null = readMessage(m);
      if (write !== null && write.member === member) deliver(write);
    });
    channel = made;
    return made;
  };
  return {
    announce: (write: OwnWrite): void => {
      const message: OwnWriteMessage = { member, installId: write.installId, backend: write.backend, keys: [...write.keys] };
      opened().postMessage(message);
      deliver(write);
    },
    listen: (installId: string, listener: (change: StorageChange) => void): Unsubscribe => {
      opened();
      const heard = (write: OwnWrite): void => {
        if (write.installId !== installId) return;
        for (const key of write.keys) listener({ backend: write.backend, key });
      };
      listeners.add(heard);
      return (): void => { listeners.delete(heard); };
    },
  };
}

/** The install's storage port, announcing each write to the member's own stores once it is answered ok. */
export function announcingStorage(storage: StoragePort, installId: string, writes: OwnWrites): StoragePort {
  const after = async <T>(reply: PortReply<T>, backend: KvBackend, keys: readonly string[]): Promise<PortAnswer<T>> => {
    const answer: PortAnswer<T> = await reply;
    if ('ok' in answer && isOwnBackend(backend)) writes.announce({ installId, backend, keys });
    return answer;
  };
  return {
    ...storage,
    KvSet: (a: OpArgs['KvSet']) => after(storage.KvSet(a), a.backend, [a.key]),
    KvSetMany: (a: OpArgs['KvSetMany']) => after(storage.KvSetMany(a), a.backend, a.entries.map((e: { key: string }) => e.key)),
    KvDelete: (a: OpArgs['KvDelete']) => after(storage.KvDelete(a), a.backend, [a.key]),
  };
}
