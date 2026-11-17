import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { WorkspaceRoles } from 'citadel-workspace-client-ts';

/**
 * Tests for `postAuthSetup` — the single source of truth for the
 * `setConnectionId → loadWorkspace → listNodes → getTreeSchema` sequence
 * after authentication. The orphan-session redirect path used to roll its
 * own subset of these calls and missed `getTreeSchema`; centralising the
 * pattern means a unit test of `postAuthSetup` covers all callers.
 *
 * We mock `WorkspaceService` rather than exercising it for real because
 * its real impl depends on a live WebSocket session — out of scope for
 * a unit test, and exactly the kind of integration concern that should
 * be left to the Playwright integration suite.
 */

// Spies declared via `vi.hoisted` so they exist before `vi.mock` (which
// is itself hoisted) evaluates its factory.
const spies: {
  calls: { name: string; args: unknown[] }[];
  setConnectionIdSpy: ReturnType<typeof vi.fn>;
  loadWorkspaceSpy: ReturnType<typeof vi.fn>;
  listNodesSpy: ReturnType<typeof vi.fn>;
  listMembersSpy: ReturnType<typeof vi.fn>;
  getTreeSchemaSpy: ReturnType<typeof vi.fn>;
} = vi.hoisted(() => {
  const calls: { name: string; args: unknown[] }[] = [];
  return {
    calls,
    setConnectionIdSpy: vi.fn((cid: bigint) => {
      calls.push({ name: 'setConnectionId', args: [cid] });
    }),
    loadWorkspaceSpy: vi.fn(async () => {
      calls.push({ name: 'loadWorkspace', args: [] });
    }),
    listNodesSpy: vi.fn(async () => {
      calls.push({ name: 'listNodes', args: [] });
    }),
    listMembersSpy: vi.fn(async () => {
      calls.push({ name: 'listMembers', args: [] });
    }),
    getTreeSchemaSpy: vi.fn(async () => {
      calls.push({ name: 'getTreeSchema', args: [] });
    }),
  };
});

vi.mock('@/lib/workspace-service', () => ({
  default: {
    setConnectionId: spies.setConnectionIdSpy,
    loadWorkspace: spies.loadWorkspaceSpy,
    listNodes: spies.listNodesSpy,
    getTreeSchema: spies.getTreeSchemaSpy,
    listMembers: spies.listMembersSpy,
  },
}));

// The role table's read, the same boundary: a server round trip over the live session.
vi.mock('@/lib/workspace-roles/roles-api', () => ({
  rolesApi: {
    list: async (): Promise<WorkspaceRoles> => {
      spies.calls.push({ name: 'listRoles', args: [] });
      return { roles: [], default_role_id: 'member' };
    },
  },
}));

import { postAuthSetup } from '../post-auth-setup';

describe('postAuthSetup', () => {
  beforeEach(() => {
    spies.calls.length = 0;
    spies.setConnectionIdSpy.mockClear();
    spies.loadWorkspaceSpy.mockClear();
    spies.listMembersSpy.mockClear();
    spies.listNodesSpy.mockClear();
    spies.getTreeSchemaSpy.mockClear();
  });

  it('runs the full sequence in order: setConnectionId → loadWorkspace → listNodes → getTreeSchema', async () => {
    const cid: bigint = 42n;
    await postAuthSetup(cid);

    expect(spies.calls.map(c => c.name)).toEqual([
      'setConnectionId',
      'loadWorkspace',
      'listNodes',
      'getTreeSchema',
      // The members, which is how this client learns its OWN role: the server
      // promotes the first account to Admin on connect and the browser was
      // reading role from a stored session record written once at registration.
      // Nothing asked for the list at boot, so an administrator who never opened
      // the members panel was shown a member's app.
      'listMembers',
      // The role table, read again: after a reconnect or claim it was kept from before.
      'listRoles',
    ]);
    expect(spies.setConnectionIdSpy).toHaveBeenCalledWith(cid);
  });

  it('skips getTreeSchema when skipTreeSchema option is set', async () => {
    await postAuthSetup(99n, { skipTreeSchema: true });
    expect(spies.calls.map(c => c.name)).toEqual([
      'setConnectionId',
      'loadWorkspace',
      'listNodes',
      // Skipping the tree schema does not skip the role: a caller that does not
      // need entity types still needs to know whether it is an administrator.
      'listMembers',
      'listRoles',
    ]);
    expect(spies.getTreeSchemaSpy).not.toHaveBeenCalled();
  });

  it('propagates errors from any step instead of silently swallowing them', async () => {
    spies.loadWorkspaceSpy.mockRejectedValueOnce(new Error('boom'));
    await expect(postAuthSetup(1n)).rejects.toThrow('boom');
    // setConnectionId ran (synchronous, before the failing step)
    expect(spies.setConnectionIdSpy).toHaveBeenCalled();
    // listNodes/getTreeSchema must NOT have run after the failure
    expect(spies.listNodesSpy).not.toHaveBeenCalled();
    expect(spies.getTreeSchemaSpy).not.toHaveBeenCalled();
  });

  it('halts the sequence when listNodes fails after loadWorkspace succeeds', async () => {
    // Partial-failure pin: each step in the sequence is awaited, so a
    // mid-sequence failure must short-circuit the rest. This is the
    // exact "partial state" case the previous orphan-redirect path
    // could leave (CID set, workspace loaded, but tree never listed)
    // and the reason centralising into `postAuthSetup` makes the
    // failure deterministic instead of silently incomplete.
    //
    // Note: we check the spies' `toHaveBeenCalled` predicate rather
    // than the in-body `calls` array because `mockRejectedValueOnce`
    // bypasses the spy's body — the function returns a rejected
    // promise without ever pushing into `calls`.
    spies.listNodesSpy.mockRejectedValueOnce(new Error('listNodes blew up'));
    await expect(postAuthSetup(2n)).rejects.toThrow('listNodes blew up');

    expect(spies.setConnectionIdSpy).toHaveBeenCalled();
    expect(spies.loadWorkspaceSpy).toHaveBeenCalled();
    expect(spies.listNodesSpy).toHaveBeenCalled();
    expect(spies.getTreeSchemaSpy).not.toHaveBeenCalled();
  });

  it('halts the sequence when getTreeSchema fails (no swallowing of the final-step error)', async () => {
    spies.getTreeSchemaSpy.mockRejectedValueOnce(new Error('schema fetch failed'));
    await expect(postAuthSetup(3n)).rejects.toThrow('schema fetch failed');

    // All four steps were entered; the rejection bubbles up from the
    // last one.
    expect(spies.setConnectionIdSpy).toHaveBeenCalled();
    expect(spies.loadWorkspaceSpy).toHaveBeenCalled();
    expect(spies.listNodesSpy).toHaveBeenCalled();
    expect(spies.getTreeSchemaSpy).toHaveBeenCalled();
  });
});
