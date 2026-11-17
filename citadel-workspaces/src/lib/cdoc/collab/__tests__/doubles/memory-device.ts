/**
 * This device's storage for tests that script the base copy themselves: the copy as the test
 * gives it, and the held edits, choices and open instances in memory, as indexedDbDocumentCache
 * keeps them (its own tests, document-cache.test.ts, hold it to the IndexedDB seam). The locks
 * stand in for the Web Locks API, which jsdom does not have: a held name is an open tab.
 */
import type { InstanceLocks } from '../../instance-locks';
import type { DeviceChoices, DocumentCache, HeldEdits } from '../../ports';

export interface MemoryLocks extends InstanceLocks {
  /** The tab holding `name` closed (or crashed): the browser released its lock. */
  drop(name: string): void;
}

export function memoryLocks(): MemoryLocks {
  const held: Set<string> = new Set<string>();
  return {
    hold: (name: string): Promise<() => void> => {
      if (held.has(name)) return Promise.reject(new Error(`"${name}" is already held by another tab`));
      held.add(name);
      return Promise.resolve((): void => { held.delete(name); });
    },
    held: (): Promise<ReadonlySet<string>> => Promise.resolve(new Set<string>(held)),
    drop: (name: string): void => { held.delete(name); },
  };
}

export interface MemoryDevice {
  readonly cache: DocumentCache;
  readonly locks: MemoryLocks;
  /** Held edits by `${nodeId}/${instance}`, each a copy as IndexedDB would hand back. */
  readonly edits: Map<string, readonly Uint8Array[]>;
  readonly choices: Map<string, DeviceChoices>;
}

export function memoryDevice(base: Pick<DocumentCache, 'load' | 'save' | 'forget'>): MemoryDevice {
  const locks: MemoryLocks = memoryLocks();
  const edits: Map<string, readonly Uint8Array[]> = new Map<string, readonly Uint8Array[]>();
  const choices: Map<string, DeviceChoices> = new Map<string, DeviceChoices>();
  const lockOf = (nodeId: string, instance: string): string => `${nodeId}/${instance}`;
  const cache: DocumentCache = {
    ...base,
    loadEdits: async (nodeId: string): Promise<readonly HeldEdits[]> => {
      const open: ReadonlySet<string> = await locks.held();
      return [...edits.entries()]
        .filter(([key]: [string, readonly Uint8Array[]]): boolean => key.startsWith(`${nodeId}/`))
        .map(([key, updates]: [string, readonly Uint8Array[]]): HeldEdits => ({ instance: key.slice(nodeId.length + 1), updates: updates.map((u: Uint8Array): Uint8Array => u.slice()), open: open.has(key) }));
    },
    saveEdits: (nodeId: string, instance: string, updates: readonly Uint8Array[]): Promise<void> => {
      if (updates.length === 0) edits.delete(lockOf(nodeId, instance));
      else edits.set(lockOf(nodeId, instance), updates.map((u: Uint8Array): Uint8Array => u.slice()));
      return Promise.resolve();
    },
    hold: (nodeId: string, instance: string): Promise<() => void> => locks.hold(lockOf(nodeId, instance)),
    loadChoices: (nodeId: string): Promise<DeviceChoices | null> => Promise.resolve(choices.get(nodeId) ?? null),
    saveChoices: (nodeId: string, chosen: DeviceChoices): Promise<void> => { choices.set(nodeId, chosen); return Promise.resolve(); },
  };
  return { cache, locks, edits, choices };
}
