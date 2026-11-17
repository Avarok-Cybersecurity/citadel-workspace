/**
 * One account's records of every kind, written and read through the production writers and
 * readers (the document cache, the kept edit answer, the kept tree), on a page loaded fresh:
 * `page()` resets the modules, as a reload does, so nothing held in memory survives it, and
 * provides the agent double again, as the reloaded page's boot does.
 */
import type { DomainNode } from '@/components/layout/sidebar/tree-node-types';
import type { CachedDocument, DeviceChoices, DocumentCache, HeldEdits } from '@/lib/cdoc/collab/ports';
import type { CachedWorkspaceTree } from '@/lib/offline-tree';

export const ACCOUNT: bigint = 4_000_000_000_000_000_001n;
export const NODE: string = 'node-plan';
export const OTHER_NODE: string = 'node-notes';
/** Text no record may show while sealed. */
export const TOKEN: string = 'Zq8Hidden';

export interface Page {
  readonly seam: typeof import('@/lib/document-replica-cache');
  readonly cache: DocumentCache;
  readonly access: typeof import('@/lib/document-save/last-known-access');
}

export async function page(): Promise<Page> {
  const { vi } = await import('vitest');
  vi.resetModules();
  await (await import('./device-records')).provideAgentDouble();
  const seam: Page['seam'] = await import('@/lib/document-replica-cache');
  const { indexedDbDocumentCache } = await import('@/lib/cdoc/collab/document-cache');
  const { memoryLocks } = await import('@/lib/cdoc/collab/__tests__/doubles/memory-device');
  return { seam, cache: indexedDbDocumentCache(ACCOUNT, memoryLocks()), access: await import('@/lib/document-save/last-known-access') };
}

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

export const KEPT_TREE: CachedWorkspaceTree = { savedAt: 1_700_000_000_000, nodes: { [NODE]: { id: NODE, name: `Plan ${TOKEN}`, metadata: [] } as unknown as DomainNode } };

export async function keepEverything(p: Page): Promise<void> {
  await p.cache.save(NODE, { docVersion: 2, seq: 7n, snapshot: utf8(`snapshot ${TOKEN}`) });
  await p.cache.saveEdits(NODE, 'tab-1', [utf8(`edit ${TOKEN}`)]);
  await p.cache.saveChoices(NODE, { autoSave: false });
  await p.access.rememberEditAnswer(ACCOUNT, NODE, true);
  await p.seam.saveWorkspaceTree(ACCOUNT, KEPT_TREE);
}

export interface Everything {
  readonly base: CachedDocument | null;
  readonly edits: readonly HeldEdits[];
  readonly choices: DeviceChoices | null;
  readonly access: boolean | null;
  readonly tree: CachedWorkspaceTree | null;
}

/** Byte views as plain arrays: jsdom's and Node's Uint8Array are different classes to toEqual. */
export function plainly(value: unknown): unknown {
  if (ArrayBuffer.isView(value)) return Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
  if (Array.isArray(value)) return value.map(plainly);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(Object.entries(value).map(([k, v]: [string, unknown]): [string, unknown] => [k, plainly(v)]));
}

/** Every record read back, byte views as plain arrays. */
export async function readEverything(p: Page): Promise<unknown> {
  return plainly({
    base: await p.cache.load(NODE),
    edits: await p.cache.loadEdits(NODE),
    choices: await p.cache.loadChoices(NODE),
    access: await p.access.lastKnownEditAnswer(ACCOUNT, NODE),
    tree: await p.seam.loadWorkspaceTree(ACCOUNT),
  } satisfies Everything);
}

export const EVERYTHING: unknown = plainly({
  base: { docVersion: 2, seq: 7n, snapshot: utf8(`snapshot ${TOKEN}`) },
  edits: [{ instance: 'tab-1', updates: [utf8(`edit ${TOKEN}`)], open: false }],
  choices: { autoSave: false },
  access: true,
  tree: KEPT_TREE,
} satisfies Everything);
