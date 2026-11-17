/**
 * "Not in the store" and "the store has not answered yet" are different facts.
 *
 * `getGroup` reads the module store synchronously; the restore from IndexedDB is
 * asynchronous. `GroupChatPage` looked its group up on mount, found nothing, and
 * navigated away with "This group may have been deleted" — on every reload,
 * bookmark and shared `/groups/:id` link. Deterministically, not as a race: all
 * effects of a commit run before any microtask from that read can resolve.
 *
 * The persistence layer was added specifically to fix this, and its own comment
 * says so. Nothing ever waited for it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h: { stored: unknown[]; resolveLoad: () => void; } = vi.hoisted((): { stored: unknown[]; resolveLoad: () => void; } => ({ stored: [] as unknown[], resolveLoad: (): void => {} }));

vi.mock('../group-persistence', () => ({
  loadPersistedGroups: (): Promise<unknown> =>
    new Promise((resolve) => {
      // Held open so a test can observe the window the page used to fall into.
      h.resolveLoad = (): void => resolve(h.stored);
    }),
  persistGroups: (): Promise<void> => Promise.resolve(),
}));

// Transformed at collection, which no test timeout measures, not in the first
// test; each test still gets a fresh, unhydrated store from freshStore().
import '../group-store';

async function freshStore(): Promise<typeof import('../group-store')> {
  vi.resetModules();
  return import('../group-store');
}

beforeEach(() => {
  h.stored = [];
});

describe('areGroupsHydrated', () => {
  it('is false before the restore resolves, even with an empty store', async () => {
    const store: Awaited<ReturnType<typeof freshStore>> = await freshStore();

    const restoring: Promise<void> = store.restorePersistedGroups();

    expect(store.getGroups()).toEqual([]);
    // The whole point: an empty list here means "not answered yet", and a
    // consumer that treats it as "no such group" is wrong.
    expect(store.areGroupsHydrated()).toBe(false);

    h.resolveLoad();
    await restoring;
  });

  it('is true once the restore resolves, even when it found nothing', async () => {
    const store: Awaited<ReturnType<typeof freshStore>> = await freshStore();
    h.stored = [];

    const restoring: Promise<void> = store.restorePersistedGroups();
    h.resolveLoad();
    await restoring;

    // "Hydration finished" and "there are groups" are different facts. A
    // consumer waiting on the first would wait forever if only the second set
    // it — which the early `if (stored.length === 0) return;` used to do.
    expect(store.areGroupsHydrated()).toBe(true);
  });

  it('restores the groups it found', async () => {
    const store: Awaited<ReturnType<typeof freshStore>> = await freshStore();
    h.stored = [{ id: 'g1', name: 'Engineering', members: [], unreadCount: 0 }];

    const restoring: Promise<void> = store.restorePersistedGroups();
    h.resolveLoad();
    await restoring;

    expect(store.getGroups().map((g) => g.id)).toEqual(['g1']);
    expect(store.areGroupsHydrated()).toBe(true);
  });

  it('notifies subscribers when hydration completes', async () => {
    const store: Awaited<ReturnType<typeof freshStore>> = await freshStore();
    const seen: boolean[] = [];
    store.subscribeToGroups(() => seen.push(store.areGroupsHydrated()));

    const restoring: Promise<void> = store.restorePersistedGroups();
    h.resolveLoad();
    await restoring;

    // Without a notification the page would wait forever: useSyncExternalStore
    // re-reads only when told to.
    expect(seen).toContain(true);
  });
});
