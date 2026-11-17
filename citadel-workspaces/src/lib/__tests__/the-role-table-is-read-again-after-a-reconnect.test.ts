/**
 * The role table is read again whenever this tab's session is set up again: a sign-in, a claim
 * of the same session, or the agent's link to the server coming back. The store asks once per
 * session, so without this an edit made while the tab was not listening showed only after a
 * session change.
 *
 * Real: postAuthSetup, the role-table store, and the reconnect handler. Doubled: the workspace
 * service and `rolesApi`, the I/O boundaries (each call is a server round trip over a live
 * WebSocket, which a unit test does not have).
 */
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { WorkspaceRoles } from 'citadel-workspace-client-ts';
import { getRolesState, requestRoles, resetRoles } from '@/lib/workspace-roles/roles-store';
import { handleServerReconnectEvent, type ServerReconnectIO } from '@/lib/reconnect/server-reconnect';
import { SEED, withDefault } from '@/test-utils/role-table';

const list: Mock<() => Promise<WorkspaceRoles>> = vi.hoisted(() => vi.fn<() => Promise<WorkspaceRoles>>());
vi.mock('@/lib/workspace-roles/roles-api', () => ({ rolesApi: { list } }));
vi.mock('@/lib/workspace-service', () => ({
  default: {
    setConnectionId: (): void => undefined,
    loadWorkspace: async (): Promise<void> => undefined,
    listNodes: async (): Promise<void> => undefined,
    getTreeSchema: async (): Promise<void> => undefined,
    listMembers: async (): Promise<void> => undefined,
  },
}));

import { postAuthSetup } from '../post-auth-setup';

/** Edited by an administrator while this tab was not listening. */
const EDITED_OFFLINE: WorkspaceRoles = withDefault(SEED, 'guest');
const CID: bigint = 7n;

async function holdingTheOldTable(): Promise<void> {
  list.mockResolvedValueOnce(SEED);
  requestRoles(list);
  await vi.waitFor((): void => { expect(getRolesState()).toEqual({ status: 'loaded', table: SEED }); });
}

beforeEach((): void => {
  resetRoles();
  list.mockReset();
});

describe('the role table after a reconnect or a claim', () => {
  it('is read again by the post-auth setup a claim runs', async () => {
    await holdingTheOldTable();
    list.mockResolvedValueOnce(EDITED_OFFLINE);
    await postAuthSetup(CID);
    expect(getRolesState()).toEqual({ status: 'loaded', table: EDITED_OFFLINE });
  });

  it('is read again when the agent reports the server link back', async () => {
    await holdingTheOldTable();
    list.mockResolvedValueOnce(EDITED_OFFLINE);
    const io: ServerReconnectIO = {
      ownSession: async () => ({ cid: CID, username: 'me', server: 'work.example' }),
      setReconnecting: (): void => undefined,
      resumePeers: async (): Promise<void> => undefined,
      reloadWorkspace: (cid: bigint): Promise<void> => postAuthSetup(cid),
      signInAgain: (): void => undefined,
    };
    await handleServerReconnectEvent({ kind: 'reconnected', cid: CID }, io);
    expect(getRolesState()).toEqual({ status: 'loaded', table: EDITED_OFFLINE });
  });

  it('does not fail the sign-in of an account the server will not show the table yet', async () => {
    list.mockRejectedValueOnce(new Error('Permission denied: ViewContent required'));
    await expect(postAuthSetup(CID)).resolves.toBeUndefined();
    expect(getRolesState()).toEqual({ status: 'failed', reason: 'Permission denied: ViewContent required' });
  });
});
