/**
 * TEST FAKE: the server's KV as one in-memory map, behind the storage port a glue instance calls,
 * so a test drives the Calendar's real ports and gate over a store it can fill and inspect. Keys
 * are held per backend (an authored key under its author), and lists answer one page at a time.
 */
import type { KvBackend } from '@/lib/citadel-apps/sdk/generated/KvBackend';
import type { AuthoredKey } from '@/lib/citadel-apps/sdk/generated/AuthoredKey';
import type { StoragePort } from '@/lib/citadel-apps/host/ports';

/** The kernel's answer to a call the member's rights on the node do not cover. */
const DENIED = { refused: { policy: 'permission' } } as const;

/** Small, so every multi-key test also crosses a page boundary. */
const PAGE: number = 2;

export class MemoryStore {
  /**
   * `values` may be shared by several members' stores, as the kernel's KV is one store: each
   * member's own `user` keys stay theirs (`user:<me>|key`), every node key is everyone's.
   */
  constructor(private readonly me: string, readonly values: Map<string, Uint8Array> = new Map()) {}

  /**
   * Nodes whose keys this member may not read (no `ViewContent`) or write (no `EditMdx` for a
   * node's own keys), refused as the kernel refuses them. Empty unless a test takes a right away.
   */
  readonly unreadable: Set<string> = new Set();
  readonly unwritable: Set<string> = new Set();

  private nodeOf(backend: KvBackend): string | null {
    if (typeof backend !== 'object') return null;
    return 'node' in backend ? backend.node.node_id : 'node_authored' in backend ? backend.node_authored.node_id : null;
  }

  private denied(backend: KvBackend, writing: boolean): boolean {
    const node: string | null = this.nodeOf(backend);
    if (node === null) return false;
    if (this.unreadable.has(node)) return true;
    return writing && typeof backend === 'object' && 'node' in backend && this.unwritable.has(node);
  }

  /** Where a key lives; an authored write lands under the signed-in member, as the kernel stamps it. */
  where(backend: KvBackend, key: string, writing: boolean): string {
    if (backend === 'user') return `user:${this.me}|${key}`;
    if (typeof backend === 'string') return `${backend}|${key}`;
    if ('node' in backend) return `node:${backend.node.node_id}|${key}`;
    const author: string | null = writing ? this.me : backend.node_authored.author;
    return `authored:${backend.node_authored.node_id}:${author ?? ''}|${key}`;
  }

  put(backend: KvBackend, key: string, value: Uint8Array): void {
    this.values.set(this.where(backend, key, true), value);
  }

  /** A write naming another author is refused, as the kernel refuses it (`authored_namespace`, policy `author`). */
  private foreign(backend: KvBackend): boolean {
    return typeof backend === 'object' && 'node_authored' in backend && backend.node_authored.author !== null && backend.node_authored.author !== this.me;
  }

  /**
   * The same port answering on a later turn, as the kernel does over the network, so two callers'
   * reads and writes can interleave (a race a synchronous fake can never show).
   */
  slowPort(): StoragePort {
    const fast: StoragePort = this.port();
    const later = <A, R>(op: (args: A) => R) => (args: A): Promise<R> =>
      new Promise<R>((answer: (r: R) => void): void => { setTimeout((): void => answer(op(args)), 0); });
    return {
      KvGet: later(fast.KvGet), KvSet: later(fast.KvSet), KvSetMany: later(fast.KvSetMany), KvDelete: later(fast.KvDelete),
      KvList: later(fast.KvList), KvListAuthored: later(fast.KvListAuthored),
    } as StoragePort;
  }

  port(): StoragePort {
    const page = <T>(all: T[], cursor: string | null): { items: T[]; next: string | null } => {
      const from: number = cursor === null ? 0 : Number(cursor);
      return { items: all.slice(from, from + PAGE), next: from + PAGE < all.length ? String(from + PAGE) : null };
    };
    return {
      KvGet: ({ backend, key }) => (this.denied(backend, false) ? DENIED : { ok: { value: this.values.get(this.where(backend, key, false)) ?? null } }),
      KvSet: ({ backend, key, value }): { readonly refused: { readonly policy: "permission"; }; } | { refused: { policy: string; }; ok?: undefined; } | { ok: null; refused?: undefined; } => {
        if (this.denied(backend, true)) return DENIED;
        if (this.foreign(backend)) return { refused: { policy: 'author' } };
        this.put(backend, key, value);
        return { ok: null };
      },
      KvSetMany: ({ backend, entries }): { readonly refused: { readonly policy: "permission"; }; } | { refused: { policy: string; }; ok?: undefined; } | { ok: null; refused?: undefined; } => {
        if (this.denied(backend, true)) return DENIED;
        if (this.foreign(backend)) return { refused: { policy: 'author' } };
        for (const e of entries) this.put(backend, e.key, e.value);
        return { ok: null };
      },
      KvDelete: ({ backend, key }): { readonly refused: { readonly policy: "permission"; }; } | { refused: { policy: string; }; ok?: undefined; } | { ok: null; refused?: undefined; } => {
        if (this.denied(backend, true)) return DENIED;
        if (this.foreign(backend)) return { refused: { policy: 'author' } };
        this.values.delete(this.where(backend, key, true));
        return { ok: null };
      },
      KvList: ({ backend, prefix, cursor }): { readonly refused: { readonly policy: "permission"; }; } | { ok: { keys: string[]; next: string | null; }; } => {
        if (this.denied(backend, false)) return DENIED;
        const base: string = this.where(backend, '', false);
        const keys: string[] = [...this.values.keys()].filter((k) => k.startsWith(base + prefix)).map((k) => k.slice(base.length)).sort();
        const { items, next } = page(keys, cursor);
        return { ok: { keys: items, next } };
      },
      KvListAuthored: ({ node_id, prefix, cursor }): { readonly refused: { readonly policy: "permission"; }; } | { ok: { entries: AuthoredKey[]; next: string | null; }; } => {
        if (this.unreadable.has(node_id)) return DENIED;
        const head: string = `authored:${node_id}:`;
        const found: AuthoredKey[] = [...this.values.keys()].filter((k) => k.startsWith(head)).map((k) => {
          const [who, key] = k.slice(head.length).split('|') as [string, string];
          return { author: who, key };
        }).filter((e) => e.key.startsWith(prefix)).sort((a, b) => (a.author + a.key < b.author + b.key ? -1 : 1));
        const { items, next } = page(found, cursor);
        return { ok: { entries: items, next } };
      },
    };
  }
}
