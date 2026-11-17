// @vitest-environment node
/**
 * Local sign-in records are keyed by tenant and CID, and the option-A records
 * they replace are only ever deleted for the account that owns them.
 *
 * The option-A key was RP ID plus username, and every hosted tenant shares the
 * RP ID work.avarok.net: alice on one tenant and alice on another were one
 * record. Doubled: the agent's LocalDB, as an in-memory store.
 */
import { describe, expect, it } from 'vitest';
import { MemoryStore, testDeps } from '@/lib/passkey/__tests__/fakes';
import { enrolCredential } from '@/lib/passkey/__tests__/legacy-enrol';
import { hasPasskeyLogin } from '@/lib/passkey/repository';
import { hintKey, listHints, saveHint } from '../hints';
import { legacyRecordFor, retireLegacyRecords } from '../legacy';

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

describe('retiring option-A records', () => {
  it('deletes the sealed password and its keys for the account that signed in', async () => {
    const deps: ReturnType<typeof testDeps> = testDeps();
    await enrolCredential(deps, { username: 'alice', cid: 7n, label: 'Mac', password: 'pw' });
    expect(await retireLegacyRecords(deps.store, deps.rpId, 'alice', 7n)).toBe(2);
    expect(deps.store.data.size).toBe(0);
    expect(await hasPasskeyLogin(deps.store, deps.rpId, 'alice')).toBe(false);
  });

  it('leaves another tenant\'s alice alone', async () => {
    const deps: ReturnType<typeof testDeps> = testDeps();
    await enrolCredential(deps, { username: 'alice', cid: 7n, label: 'Mac', password: 'pw' });
    expect(await legacyRecordFor(deps.store, deps.rpId, 'alice', 8n)).toBeNull();
    expect(await retireLegacyRecords(deps.store, deps.rpId, 'alice', 8n)).toBe(0);
    expect(await hasPasskeyLogin(deps.store, deps.rpId, 'alice')).toBe(true);
  });
});
