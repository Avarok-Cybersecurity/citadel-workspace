/**
 * Doubles for encryption at rest, at its two I/O edges and nowhere else: the browser's store
 * (a Map that structured-clones as IndexedDB does: jsdom has none) and the agent's per-account
 * root store (the agent-held key, provided through its port as the app's boot provides it).
 * Everything between, the seam, the sweeps, the cryptography and the record readers, is
 * production code.
 *
 * Installed by a test file with:
 *   vi.mock('@/lib/storage-utils', async () => (await import('./doubles/device-records')).browserStore());
 *   await provideAgentDouble();   // and again after every vi.resetModules(), as a reload boots again
 */
import { memoryStorageUtils } from '@/lib/cdoc/collab/__tests__/doubles/memory-storage';
import type { AtRestRootStore } from '@/lib/at-rest/root-store-port';

/** `writeFirst`: another write that lands between a sweep's read of a record and its replace. */
interface Device { readonly records: Map<string, unknown>; crashAfter: number | null; replaced: number; writeFirst: { key: string; value: unknown } | null }
interface Agent { readonly roots: Map<bigint, Uint8Array>; reachable: boolean; losesWrites: boolean }
/** Kept on globalThis: a test reloads the page with vi.resetModules(), and the device outlives it. */
const held: { __atRestDoubles?: { device: Device; agent: Agent } } = globalThis as { __atRestDoubles?: { device: Device; agent: Agent } };
held.__atRestDoubles ??= {
  device: { records: new Map<string, unknown>(), crashAfter: null, replaced: 0, writeFirst: null },
  agent: { roots: new Map<bigint, Uint8Array>(), reachable: true, losesWrites: false },
};

/** The browser's records, and a crash after `crashAfter` conversions (null: never). */
export const device: Device = held.__atRestDoubles.device;

/** The agent's roots, and how it misbehaves: not answering, or answering a write it did not keep. */
export const agent: Agent = held.__atRestDoubles.agent;

export function resetDoubles(): void {
  device.records.clear();
  device.crashAfter = null;
  device.replaced = 0;
  device.writeFirst = null;
  agent.roots.clear();
  agent.reachable = true;
  agent.losesWrites = false;
}

export function browserStore(): Record<string, unknown> {
  const base: Record<string, unknown> = memoryStorageUtils(device.records);
  type ReplaceIf = (s: string, k: string, unchanged: (current: unknown) => boolean, v: unknown) => Promise<boolean>;
  const replaceIf: ReplaceIf = base.dbReplaceIf as ReplaceIf;
  return {
    ...base,
    dbReplaceIf: (s: string, k: string, unchanged: (current: unknown) => boolean, v: unknown): Promise<boolean> => {
      if (device.crashAfter !== null && device.replaced >= device.crashAfter) return Promise.reject(new Error('the tab closed mid-conversion'));
      device.replaced += 1;
      if (device.writeFirst !== null && device.writeFirst.key === k) {
        device.records.set(k, structuredClone(device.writeFirst.value));
        device.writeFirst = null;
      }
      return replaceIf(s, k, unchanged, v);
    },
  };
}

const unreachable = (): Promise<never> => Promise.reject(new Error('LocalDB request timed out'));

const agentRootStore: AtRestRootStore = {
  read: (account: bigint): Promise<Uint8Array | null> => (agent.reachable ? Promise.resolve(agent.roots.has(account) ? Uint8Array.from(agent.roots.get(account) as Uint8Array) : null) : unreachable()),
  write: (account: bigint, root: Uint8Array): Promise<void> => {
    if (!agent.reachable) return unreachable();
    if (!agent.losesWrites) agent.roots.set(account, Uint8Array.from(root));
    return Promise.resolve();
  },
  remove: (account: bigint): Promise<void> => {
    if (!agent.reachable) return unreachable();
    agent.roots.delete(account);
    return Promise.resolve();
  },
};

/** Provides the agent double to the page's port (the module loaded now, so after a reset too). */
export async function provideAgentDouble(): Promise<void> {
  (await import('@/lib/at-rest/root-store-port')).provideAtRestRootStore(async (): Promise<AtRestRootStore> => agentRootStore);
}

/** Whether `token` is anywhere in what the browser stores, as text or as UTF-8 bytes. */
export function storedAnywhere(token: string): boolean {
  const bytes: Uint8Array = new TextEncoder().encode(token);
  const inBytes = (view: Uint8Array): boolean => {
    for (let i: number = 0; i + bytes.length <= view.length; i += 1) if (bytes.every((b: number, j: number): boolean => view[i + j] === b)) return true;
    return false;
  };
  const visit = (value: unknown): boolean => {
    if (typeof value === 'string') return value.includes(token);
    if (ArrayBuffer.isView(value)) return inBytes(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
    if (Array.isArray(value)) return value.some(visit);
    if (typeof value === 'object' && value !== null) return Object.entries(value).some(([k, v]: [string, unknown]): boolean => k.includes(token) || visit(v));
    return false;
  };
  return [...device.records.values()].some(visit);
}
