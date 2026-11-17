/**
 * A sealed record this page cannot open reads as LOCKED, never as data and never as nothing:
 * with no key here (a new page whose agent does not answer, or whose root is gone), and when a
 * sealed value is moved to another record's key, or on a page given no store for the agent-held key. Turning encryption off is refused while any
 * record is locked; sign-out removes sealed records, the kept tree, the setting and the root.
 *
 * Doubles only at the two I/O edges (doubles/device-records.ts).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AT_REST_REFUSED_LOCKED, AT_REST_REFUSED_UNREACHABLE } from '../at-rest-copy';
import { isRecordLocked } from '../at-rest-shape';
import { agent, device, resetDoubles } from './doubles/device-records';
import { ACCOUNT, NODE, OTHER_NODE, keepEverything, page, type Page } from './doubles/kept-records';

vi.mock('@/lib/storage-utils', async () => (await import('./doubles/device-records')).browserStore());

const key = (record: string): string => `cdoc-collab:${ACCOUNT.toString()}:${record}`;

/** What a read did: the value, or that it was locked; anything else rethrown. */
async function outcome(read: Promise<unknown>): Promise<'locked' | { value: unknown }> {
  try {
    return { value: await read };
  } catch (error: unknown) {
    if (isRecordLocked(error)) return 'locked';
    throw error;
  }
}

async function sealedEverything(): Promise<void> {
  const p: Page = await page();
  await keepEverything(p);
  await p.seam.setDocumentsAtRest(ACCOUNT, true);
}

beforeEach((): void => { resetDoubles(); });

describe('a sealed record with no key on this page', () => {
  it('reads as locked, every kind of it, when the agent does not answer', async () => {
    await sealedEverything();
    agent.reachable = false;
    const p: Page = await page();
    expect(await outcome(p.cache.load(NODE))).toBe('locked');
    expect(await outcome(p.cache.loadEdits(NODE))).toBe('locked');
    expect(await outcome(p.cache.loadChoices(NODE))).toBe('locked');
    expect(await outcome(p.access.lastKnownEditAnswer(ACCOUNT, NODE))).toBe('locked');
    expect(await outcome(p.seam.loadWorkspaceTree(ACCOUNT))).toBe('locked');
  });

  it('reads as locked on a page given no store for the agent-held key, and is not turned on there', async () => {
    await sealedEverything();
    vi.resetModules();
    const seam: typeof import('@/lib/document-replica-cache') = await import('@/lib/document-replica-cache');
    expect(await outcome(seam.loadWorkspaceTree(ACCOUNT))).toBe('locked');
    await expect(seam.setDocumentsAtRest(ACCOUNT + 1n, true)).rejects.toThrow(AT_REST_REFUSED_UNREACHABLE);
    expect(await seam.documentsAtRest(ACCOUNT + 1n)).toBe(false);
  });

  it('reads as locked when the root it was sealed with is gone, and is never written over plainly', async () => {
    await sealedEverything();
    agent.roots.clear();
    const p: Page = await page();
    expect(await outcome(p.cache.load(NODE))).toBe('locked');
    // A new write is sealed under a new root; the old record stays locked, not misread.
    await p.cache.saveChoices(OTHER_NODE, { autoSave: true });
    expect(await outcome(p.cache.loadChoices(OTHER_NODE))).toEqual({ value: { autoSave: true } });
    expect(await outcome(p.cache.loadChoices(NODE))).toBe('locked');
  });
});

describe('a sealed record moved to another key', () => {
  it('is locked: the node and the kind are bound to it', async () => {
    await sealedEverything();
    device.records.set(key(OTHER_NODE), device.records.get(key(NODE)));
    device.records.set(key(`${NODE}#access`), device.records.get(key(`${NODE}#device`)));
    const p: Page = await page();
    expect(await outcome(p.cache.load(OTHER_NODE))).toBe('locked');
    expect(await outcome(p.access.lastKnownEditAnswer(ACCOUNT, NODE))).toBe('locked');
    expect(await outcome(p.cache.load(NODE))).not.toBe('locked');
  });
});

describe('turning encryption off', () => {
  it('is refused, with nothing changed, while a record is locked', async () => {
    await sealedEverything();
    agent.roots.clear();
    const p: Page = await page();
    const before: string[] = [...device.records.keys()];
    await expect(p.seam.setDocumentsAtRest(ACCOUNT, false)).rejects.toThrow(AT_REST_REFUSED_LOCKED);
    expect([...device.records.keys()]).toEqual(before);
    expect(await p.seam.documentsAtRest(ACCOUNT)).toBe(true);
  });
});

describe('signing out', () => {
  it('removes sealed records, the kept tree, the setting and the agent root', async () => {
    await sealedEverything();
    expect(agent.roots.has(ACCOUNT)).toBe(true);
    const p: Page = await page();
    await p.seam.forgetAtRestRoot(ACCOUNT);
    await p.seam.forgetAccountDocuments(ACCOUNT);
    expect([...device.records.keys()]).toEqual([]);
    expect(agent.roots.has(ACCOUNT)).toBe(false);
  });
});
