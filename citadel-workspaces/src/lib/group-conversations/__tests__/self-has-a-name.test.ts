/**
 * The creator's own username reaches `group:created`.
 *
 * CI showed `Group created: {name: , ownerId: ..., ownerUsername: }` on the
 * CREATOR's page. `group:created` falls back to `ownerUsername` for the label,
 * so a group the user had just named appeared in their own sidebar with no name
 * at all -- while the copy built from the invite, one line below, had a
 * perfectly good username in it.
 *
 * `resolveSelf` returned `tab?.selectedUsername ?? ''`. When the tab context
 * has no selection, an empty string is not a name; the tab's stored session
 * has one.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const selection: { current: { selectedUsername?: string } | null } = { current: null };
const storedSession: { current: { username: string } | null } = { current: null };
let sessionReads: number = 0;

// Partial mocks, spreading the real module. A bare object replaced the whole
// thing, and another module imports `reissueTabId` from tab-context -- which
// only breaks once the suite shares a module graph, so the file passed alone
// and failed together.
vi.mock('@/lib/tab-context', async (importOriginal) => {
  const actual: Record<string, unknown> = await importOriginal();
  return { ...actual, getSelectedUser: async (): Promise<unknown> => selection.current };
});
// Bare, unlike tab-context above: spreading the real connection module constructed its
// ConnectionManager singleton during import ("Cannot read properties of undefined (reading
// 'onEvent')"), and re-importing it for every test ran past the 5 s budget in a loaded run. The
// response service needs these two and nothing else from it.
vi.mock('@/lib/connection', () => ({
  connectionManager: {
    getConnectionInfo: (): { cid: bigint } => ({ cid: 7n }),
    // Counted only when the response service is the caller: the multi-tab channel's announce timer
    // reads the tab session too (lib/p2p/current-cid), and those reads made the count depend on
    // scheduling -- 7 instead of 1 in a loaded run.
    getTabSelectedSession: async (): Promise<unknown> => {
      if (new Error().stack?.includes('group-response-service')) sessionReads += 1;
      return storedSession.current;
    },
  },
}));

// Held across each test's vi.resetModules() as the real module: through
// roster-peer-name it brings ~155 of the ~190 modules the response service
// re-imports, none of which holds who the creator is, and every reset module is a
// round trip to the vitest main process. See p2p/__tests__/an-edit-or-delete-survives-a-reload.
vi.mock('@/lib/p2p-registration-service', async (importOriginal) => importOriginal());

// Transformed at collection, which no test timeout measures, not in the first test.
import '../group-response-service';

describe('who the creator is', () => {
  beforeEach(() => {
    selection.current = null;
    storedSession.current = null;
    sessionReads = 0;
    vi.resetModules();
  });

  it('falls back to the tab session when the selection has no username', async () => {
    storedSession.current = { username: 'ada' };
    const { resolveSelfForTest } = await import('../group-response-service');
    expect((await resolveSelfForTest())?.username).toBe('ada');
  });

  it('prefers the tab selection when it has one', async () => {
    // Positive control: the fallback must not outrank the authority.
    selection.current = { selectedUsername: 'grace' };
    storedSession.current = { username: 'ada' };
    const { resolveSelfForTest } = await import('../group-response-service');
    expect((await resolveSelfForTest())?.username).toBe('grace');
  });

  it('is empty only when neither knows', async () => {
    const { resolveSelfForTest } = await import('../group-response-service');
    expect((await resolveSelfForTest())?.username).toBe('');
  });

  it('reads the stored session once, not on every message', async () => {
    // `getTabSelectedSession` calls `getSelectedUser` again and then reads the
    // active session index, and this runs for EVERY websocket message. Round
    // 430 added it unmemoised, and `test:notifications` went from 18 minutes to
    // over 54 on the next run.
    storedSession.current = { username: 'ada' };
    const { resolveSelfForTest } = await import('../group-response-service');

    for (let i: number = 0; i < 25; i += 1) await resolveSelfForTest();

    expect(sessionReads).toBe(1);
  });
});
