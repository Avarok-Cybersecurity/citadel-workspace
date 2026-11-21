// @vitest-environment node
/**
 * Local sign-in records are keyed by tenant and CID: every hosted tenant shares
 * the RP ID work.avarok.net, so a username alone would make alice on one tenant
 * and alice on another one record. Doubled: the agent's LocalDB, as an in-memory store.
 */
import { describe, expect, it } from 'vitest';
import { MemoryStore } from '@/lib/passkey/__tests__/fakes';
import { hintKey, listHints, saveHint } from '../hints';

describe('sign-in hints', () => {
  it('keep two tenants\' alices apart', async () => {
    const store: MemoryStore = new MemoryStore();
    await saveHint(store, { tenant: 'bench.work.avarok.net', cid: 7n, username: 'alice', keyFirst: true });
    await saveHint(store, { tenant: 'acme.work.avarok.net', cid: 7n, username: 'alice', keyFirst: false });
    expect((await listHints(store)).map((h) => [h.tenant, h.keyFirst])).toEqual([
      ['acme.work.avarok.net', false], ['bench.work.avarok.net', true],
    ]);
  });

  it('ignore a record filed under another account\'s key', async () => {
    const store: MemoryStore = new MemoryStore();
    await saveHint(store, { tenant: 'bench.work.avarok.net', cid: 7n, username: 'alice', keyFirst: true });
    const bytes: Uint8Array = store.data.get(hintKey('bench.work.avarok.net', 7n)) as Uint8Array;
    store.data.set(hintKey('bench.work.avarok.net', 8n), bytes as never);
    expect(await listHints(store)).toHaveLength(1);
  });
});
