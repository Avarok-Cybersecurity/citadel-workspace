/**
 * What the Calendar reaches outside itself (design 3.2, C3), as one typed object over its glue
 * instance: every method is one or more port calls through the instance's gate
 * (citadel-apps/host/glue-instance.ts), so an ungranted call is refused in the page and never
 * reaches a port. A refusal is thrown as `PortRefused`, naming the op and the host's reason; the
 * Calendar shows it, it never stands in a value for one.
 *
 * Storage addresses a store, not a backend: the member's own (`user`), a node's official events
 * (`node`), and what members posted on a node (`authored`, `author` null for every author).
 */
import type { NoticeKind } from './notify-prefs';
import type { DispatchClock } from '@/lib/citadel-apps/host/dispatch';
import type { GlueInstance, StorageChange, Unsubscribe } from '@/lib/citadel-apps/host/glue-instance';
import type { OpName } from '@/lib/citadel-apps/host/op-args';
import type { HostReply, InboundIhttpFrame, Refused, TopicArrival } from '@/lib/citadel-apps/host/ports';
import type { OpArgs, OpReplies } from '@/lib/citadel-apps/sdk/generated/AbiConstants';
import type { Address } from '@/lib/citadel-apps/sdk/generated/Address';
import type { AuthoredKey } from '@/lib/citadel-apps/sdk/generated/AuthoredKey';
import type { AuthoredPage } from '@/lib/citadel-apps/sdk/generated/AuthoredPage';
import type { Caller } from '@/lib/citadel-apps/sdk/generated/Caller';
import type { IhttpFrame } from '@/lib/citadel-apps/sdk/generated/IhttpFrame';
import type { KvBackend } from '@/lib/citadel-apps/sdk/generated/KvBackend';
import type { KvPage } from '@/lib/citadel-apps/sdk/generated/KvPage';
import type { Member } from '@/lib/citadel-apps/sdk/generated/Member';
import type { NodeInfo } from '@/lib/citadel-apps/sdk/generated/NodeInfo';
import type { Route } from '@/lib/citadel-apps/sdk/generated/Route';
import type { ServeOn } from '@/lib/citadel-apps/sdk/generated/ServeOn';
import type { Transport } from '@/lib/citadel-apps/sdk/generated/Transport';

export class PortRefused extends Error {
  constructor(readonly op: OpName, readonly refused: Refused) {
    super(`${op} was refused: ${typeof refused === 'string' ? refused : JSON.stringify(refused)}`);
    this.name = 'PortRefused';
  }
}

/** What a member is told a refusal means, in words. */
export function refusalCopy(refused: Refused): string {
  if (refused === 'ungranted') return 'the Calendar was not given access to it';
  if ('limit' in refused) return `a limit was reached (${refused.limit})`;
  if ('unavailable' in refused) return `it is not available right now (${refused.unavailable})`;
  if ('policy' in refused) return `it was refused (${refused.policy})`;
  return `the other side answered ${refused.remote}`;
}

export type CalendarStore =
  | { readonly kind: 'user' }
  | { readonly kind: 'node'; readonly node: string }
  | { readonly kind: 'authored'; readonly node: string; readonly author: string | null };

export function backendOf(store: CalendarStore): KvBackend {
  if (store.kind === 'user') return 'user';
  if (store.kind === 'node') return { node: { node_id: store.node } };
  return { node_authored: { node_id: store.node, author: store.author } };
}

export interface CalendarStorage {
  get: (store: CalendarStore, key: string) => Promise<Uint8Array | null>;
  set: (store: CalendarStore, key: string, value: Uint8Array) => Promise<void>;
  /** All or nothing, at most 64 entries (the kernel's KvSetMany bound). */
  setMany: (store: CalendarStore, entries: readonly { key: string; value: Uint8Array }[]) => Promise<void>;
  remove: (store: CalendarStore, key: string) => Promise<void>;
  /** Every key under `prefix`, every page read. */
  keys: (store: CalendarStore, prefix: string) => Promise<string[]>;
  /** Every author's keys under `prefix` on `node`, by author then key. */
  authoredKeys: (node: string, prefix: string) => Promise<AuthoredKey[]>;
}

export interface CalendarTopics {
  /** Joins the topic; resolves with who is on it now. */
  open: (name: string) => Promise<readonly string[]>;
  publish: (name: string, body: Uint8Array) => Promise<void>;
  close: (name: string) => Promise<void>;
  onArrival: (listener: (arrival: TopicArrival) => void) => Unsubscribe;
}

export interface CalendarIhttp {
  serve: (routes: readonly Route[], on: ServeOn) => Promise<void>;
  call: (to: Address, frame: IhttpFrame, transport: Transport) => Promise<void>;
  respond: (peer: Caller, frame: IhttpFrame) => Promise<void>;
  /** One inbound body chunk of `stream` was read: the host grants its sender one more credit. */
  consumed: (peer: Caller, stream: bigint) => Promise<void>;
  onFrame: (listener: (inbound: InboundIhttpFrame) => void) => Unsubscribe;
}

export interface CalendarPorts {
  readonly storage: CalendarStorage;
  readonly topics: CalendarTopics;
  readonly ihttp: CalendarIhttp;
  readonly members: () => Promise<readonly Member[]>;
  readonly node: (id: string) => Promise<NodeInfo>;
  readonly children: (id: string) => Promise<readonly NodeInfo[]>;
  /**
   * A notification in the page's list, badged with the Calendar's name by the port. The port posts
   * every kind it is given; the member's choice of kinds is applied over it (notice-gate.ts).
   */
  readonly notify: (kind: NoticeKind, title: string, body: string) => Promise<void>;
  readonly onStorageChanged: (listener: (change: StorageChange) => void) => Unsubscribe;
  /** The instance's clock: the only "now" the Calendar reads. */
  readonly clock: DispatchClock;
}

async function paged<T>(op: OpName, page: (cursor: string | null) => Promise<{ items: readonly T[]; next: string | null }>): Promise<T[]> {
  const out: T[] = [];
  const seen: Set<string> = new Set();
  let cursor: string | null = null;
  for (;;) {
    const { items, next } = await page(cursor);
    out.push(...items);
    if (next === null) return out;
    if (seen.has(next)) throw new PortRefused(op, { policy: 'cursor_repeated' });
    seen.add(next);
    cursor = next;
  }
}

export function calendarPorts(glue: GlueInstance): CalendarPorts {
  const ok = async <N extends OpName>(name: N, args: OpArgs[N]): Promise<OpReplies[N]> => {
    const reply: HostReply<OpReplies[N]> = await glue.op(name, args);
    if ('refused' in reply) throw new PortRefused(name, reply.refused);
    return reply.ok;
  };
  const done = async <N extends OpName>(name: N, args: OpArgs[N]): Promise<void> => {
    await ok(name, args);
  };
  return {
    storage: {
      get: async (store, key) => (await ok('KvGet', { backend: backendOf(store), key })).value,
      set: (store, key, value) => done('KvSet', { backend: backendOf(store), key, value }),
      setMany: (store, entries) => done('KvSetMany', { backend: backendOf(store), entries: entries.map((e) => ({ key: e.key, value: e.value })) }),
      remove: (store, key) => done('KvDelete', { backend: backendOf(store), key }),
      keys: (store, prefix) => paged('KvList', async (cursor) => {
        const page: KvPage = await ok('KvList', { backend: backendOf(store), prefix, cursor });
        return { items: page.keys, next: page.next };
      }),
      authoredKeys: (node, prefix) => paged('KvListAuthored', async (cursor) => {
        const page: AuthoredPage = await ok('KvListAuthored', { node_id: node, prefix, cursor });
        return { items: page.entries, next: page.next };
      }),
    },
    topics: {
      open: async (name) => (await ok('TopicOpen', { name })).members,
      publish: (name, body) => done('TopicPublish', { name, body }),
      close: (name) => done('TopicClose', { name }),
      onArrival: glue.onTopic,
    },
    ihttp: {
      serve: (routes, on) => done('IhttpServe', { routes: [...routes], on }),
      call: (to, frame, transport) => done('IhttpCall', { to, frame, transport }),
      respond: (peer, frame) => done('IhttpRespond', { peer, frame }),
      consumed: (peer, stream) => done('IhttpConsumed', { peer, stream }),
      onFrame: glue.onIhttp,
    },
    members: async () => (await ok('MembersList', {})).members,
    node: (id) => ok('NodeGet', { node_id: id }),
    children: async (id) => (await ok('NodeChildren', { node_id: id })).nodes,
    notify: (_kind, title, body) => done('Notify', { title, body }),
    onStorageChanged: glue.onStorageChanged,
    clock: glue.clock,
  };
}
