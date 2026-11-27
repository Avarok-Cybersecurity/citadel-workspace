/**
 * The windows (tabs) of one browser hold the same account's chat documents in the same agent
 * LocalDB, which answers only get and set. Two windows writing one copy must therefore take
 * turns (a Web Lock, which the browser shares across its windows and releases when a window
 * closes or crashes), and each must hear the other's write to bring it into its open replica.
 * The announcement carries only which copy changed: the LocalDB stays the one source of what
 * it holds, and a listener reads it from there.
 *
 * Not the apps' own-store announcer (lib/citadel-apps/runtime/own-store-writes.ts): that one
 * reports writes made through an app install's StoragePort, by install and key; chat documents
 * never pass through an install, and what a hearer must do here is merge under the same lock.
 */
import type { ChatTabs } from './chat-ports';

export const CHAT_TABS_CHANNEL: string = 'citadel-chat-documents';

/** A browser-wide exclusive lock by name (the Web Locks API's default mode). */
export interface ExclusiveLocks {
  run<T>(name: string, step: () => Promise<T>): Promise<T>;
}

/** What a BroadcastChannel offers: other windows' messages arrive, this window's own never do. */
export interface TabChannel {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (event: { readonly data: unknown }) => void): void;
}

export const chatCopyLock = (account: bigint, docId: string): string => `cdoc-chat-copy:${account.toString()}:${docId}`;
export const chatIndexLock = (account: bigint): string => `cdoc-chat-index:${account.toString()}`;

interface Listener {
  readonly account: bigint;
  readonly heard: (docId: string, writer: object | null) => void;
}

export function chatTabs(locks: ExclusiveLocks, channel: TabChannel): ChatTabs {
  const listeners: Set<Listener> = new Set<Listener>();
  const tell = (account: bigint, docId: string, writer: object | null): void => {
    for (const listener of [...listeners]) if (listener.account === account) listener.heard(docId, writer);
  };
  channel.addEventListener('message', (event: { readonly data: unknown }): void => {
    const message: unknown = event.data;
    if (typeof message !== 'object' || message === null) return;
    const { account, docId } = message as Record<string, unknown>;
    if (typeof account !== 'bigint' || typeof docId !== 'string') return;
    tell(account, docId, null);
  });
  return {
    exclusive: <T>(name: string, step: () => Promise<T>): Promise<T> => locks.run(name, step),
    wrote: (account: bigint, docId: string, writer: object): void => {
      channel.postMessage({ account, docId });
      tell(account, docId, writer);
    },
    onWrote: (account: bigint, heard: (docId: string, writer: object | null) => void): (() => void) => {
      const listener: Listener = { account, heard };
      listeners.add(listener);
      return (): void => { listeners.delete(listener); };
    },
  };
}

/** The Web Locks API, looked up at each turn. Its absence fails that turn, never "this window is the only writer". */
export function webLocks(): ExclusiveLocks {
  return {
    run: async <T>(name: string, step: () => Promise<T>): Promise<T> => {
      const locks: LockManager | undefined = typeof navigator === 'undefined' ? undefined : navigator.locks;
      if (!locks) throw new Error('This browser has no Web Locks API, so two windows could write a chat document over each other');
      // The step's promise is the lock's: held until it settles; request() answers with its outcome.
      return await locks.request(name, step);
    },
  };
}
