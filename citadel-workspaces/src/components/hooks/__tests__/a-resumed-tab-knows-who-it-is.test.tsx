/**
 * A tab knows who is signed in on it -- and what their own record says --
 * however the session got there and whichever load arrives first.
 *
 * Live (admin-lab, 2026-09-25): on every tab that had resumed a session or
 * signed in with a password, `state.currentUser` was undefined, so Settings'
 * Profile Visibility switch sat disabled and unchecked -- read as "hidden" by
 * anyone looking, while the server went on sending the profile to strangers.
 * The workspace path took the user from a per-tab record only registration
 * writes. On the one tab that had it, the member list could still arrive first,
 * and the own record's privacy choice was then never applied.
 *
 * Mocked: the tab selection and saved-session reads (IndexedDB). The hooks, the
 * events and the member mapping are the real ones.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { eventEmitter } from '@/lib/event-emitter';
import { useWorkspaceEventSetup } from '../useWorkspaceEventSetup';
import { useMemberEventSetup } from '../useMemberEventSetup';
import { mapWasmMember } from '@/lib/workspace-response-handler/member-mapping';
import { WORKSPACE_ROOT_ID } from '@/lib/workspace-constants';
import type { WorkspaceEventState } from '../../WorkspaceEventHandler';

vi.mock('@/lib/workspace-service', () => ({ default: {} }));
vi.mock('@/lib/tab-context', async (importOriginal: () => Promise<Record<string, unknown>>) => ({
  ...(await importOriginal()),
  getSelectedUser: async (): Promise<{ selectedUsername: string; selectedServerAddress: string }> => ({
    selectedUsername: 'max.lab', selectedServerAddress: 'admin-lab.work.avarok.net',
  }),
}));
vi.mock('@/lib/connection', async (importOriginal: () => Promise<Record<string, unknown>>) => {
  const real: Record<string, unknown> = await importOriginal();
  return {
    ...real,
    connectionManager: new Proxy(real.connectionManager as object, {
      get(target: object, key: string | symbol): unknown {
        if (key === 'getTabSelectedSession') return async (): Promise<null> => null;
        if (key === 'updateSessionRole') return async (): Promise<void> => undefined;
        return Reflect.get(target, key);
      },
    }),
  };
});

function harness(): { state: () => WorkspaceEventState } {
  let current: WorkspaceEventState = {
    members: {}, loading: { workspace: false, members: false, nodes: false },
  } as unknown as WorkspaceEventState;
  const setState: (update: unknown) => void = (update: unknown): void => {
    current = typeof update === 'function'
      ? (update as (p: WorkspaceEventState) => WorkspaceEventState)(current)
      : (update as WorkspaceEventState);
  };
  renderHook(() => { useWorkspaceEventSetup({ setState: setState as never }); useMemberEventSetup({ setState: setState as never }); });
  return { state: (): WorkspaceEventState => current };
}

const HIDDEN: Record<string, unknown> = { show_profile_to_strangers: { type: 'Boolean', content: false } };

async function emit(event: string, payload: unknown): Promise<void> {
  await act(async (): Promise<void> => {
    eventEmitter.emit(event, payload);
    for (let i: number = 0; i < 5; i++) await new Promise((r: (v: void) => void): void => { setTimeout(r, 0); });
  });
}

const workspaceLoaded: () => Promise<void> = (): Promise<void> => emit('workspace:loaded', { workspace: { id: 'w', name: 'Admin Lab', metadata: [] }, connection: {} });
const membersLoaded: () => Promise<void> = (): Promise<void> => emit('members:loaded', {
  domainId: WORKSPACE_ROOT_ID, connection: {},
  members: [mapWasmMember({ id: 'max.lab', name: 'Max Member', role: 'Admin', metadata: HIDDEN })],
});

describe('the tab user', () => {
  it('is known on a tab that never registered here', async () => {
    const h: ReturnType<typeof harness> = harness();
    await workspaceLoaded();
    expect(h.state().currentUser?.username).toBe('max.lab');
  });

  it('carries their own privacy choice when the members arrive first', async () => {
    const h: ReturnType<typeof harness> = harness();
    await membersLoaded();
    await workspaceLoaded();
    expect(h.state().currentUser?.showProfileToStrangers).toBe(false);
  });

  it('carries it when the workspace arrives first', async () => {
    const h: ReturnType<typeof harness> = harness();
    await workspaceLoaded();
    await membersLoaded();
    expect(h.state().currentUser?.showProfileToStrangers).toBe(false);
    expect(h.state().currentUser?.role).toBe('Admin');
  });
});
