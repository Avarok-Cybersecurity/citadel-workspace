/**
 * After a member write, the roster on screen is asked for again -- at the root too.
 *
 * `members:reload` fires once the server accepts AddMember, RemoveMember or
 * UpdateMemberRole. Its listener re-listed only when the URL had a `nodeId`,
 * and the workspace view has none: an admin who added someone from the view
 * everyone lands on saw the dialog close, "Member Added", and a roster without
 * them until a reload.
 *
 * The hook and event bus are real. The double is the send (`listMembers`); the
 * connection manager is stubbed because the hook imports it for other events.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { WORKSPACE_ROOT_ID } from '@/lib/workspace-constants';

const { listMembers } = vi.hoisted(() => ({ listMembers: vi.fn(async (): Promise<void> => {}) }));
vi.mock('@/lib/workspace-service', () => ({ default: { listMembers } }));
vi.mock('@/lib/connection', () => ({ connectionManager: {} }));

import { useMemberEventSetup } from '../useMemberEventSetup';
import { eventEmitter } from '@/lib/event-emitter';

async function reloadAt(search: string): Promise<void> {
  window.history.replaceState({}, '', `/workspace${search}`);
  const { unmount } = renderHook(() => useMemberEventSetup({ setState: vi.fn() }));
  // The listeners are attached in an async setup; emit until one hears it.
  await waitFor((): void => {
    eventEmitter.emit('members:reload', undefined);
    expect(listMembers).toHaveBeenCalled();
  });
  unmount();
}

beforeEach((): void => { listMembers.mockClear(); });

describe('reloading the roster after a member write', () => {
  it('asks for the workspace root when no node is selected', async () => {
    await reloadAt('');
    expect(listMembers).toHaveBeenCalledWith(WORKSPACE_ROOT_ID);
  });

  it('asks for the selected node when there is one', async () => {
    await reloadAt('?nodeId=office-7');
    expect(listMembers).toHaveBeenCalledWith('office-7');
    expect(listMembers).not.toHaveBeenCalledWith(WORKSPACE_ROOT_ID);
  });
});
