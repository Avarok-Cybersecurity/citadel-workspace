/**
 * A burst of reload requests is one ListMembers, not one each.
 *
 * `members:reload` is asked for by a member write once the server confirms it
 * AND by the server's announcement of the same change; several colleagues
 * joining at once ask once each. Every one of those was a round trip asking the
 * same question.
 *
 * The hook and event bus are real. The double is the send (`listMembers`), as in
 * a-root-member-write-refreshes-the-root; the connection manager is stubbed
 * because the hook imports it for other events.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { WORKSPACE_ROOT_ID } from '@/lib/workspace-constants';

const { listMembers } = vi.hoisted(() => ({ listMembers: vi.fn(async (): Promise<void> => {}) }));
vi.mock('@/lib/workspace-service', () => ({ default: { listMembers } }));
vi.mock('@/lib/connection', () => ({ connectionManager: {} }));

import { useMemberEventSetup } from '../useMemberEventSetup';
import { eventEmitter } from '@/lib/event-emitter';
import { workspaceEvents } from '@/lib/workspace-events';

/** Longer than the hook's window, so a second run would have happened by then. */
const AFTER_THE_WINDOW_MS: number = 600;

const settle = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function mounted(): Promise<() => void> {
  window.history.replaceState({}, '', '/workspace');
  const before: number = workspaceEvents.listenerCount('members:reload');
  const { unmount } = renderHook(() => useMemberEventSetup({ setState: vi.fn() }));
  await waitFor((): void => { expect(workspaceEvents.listenerCount('members:reload')).toBeGreaterThan(before); });
  return unmount;
}

beforeEach((): void => { listMembers.mockClear(); });

describe('reloading the roster', () => {
  it('asks once for a burst', async () => {
    const unmount: () => void = await mounted();
    for (let i: number = 0; i < 5; i += 1) eventEmitter.emit('members:reload', undefined);
    await settle(AFTER_THE_WINDOW_MS);
    expect(listMembers).toHaveBeenCalledTimes(1);
    expect(listMembers).toHaveBeenCalledWith(WORKSPACE_ROOT_ID);
    unmount();
  });

  it('asks again for a later change', async () => {
    // The control: coalescing must not swallow the next, separate change.
    const unmount: () => void = await mounted();
    eventEmitter.emit('members:reload', undefined);
    await settle(AFTER_THE_WINDOW_MS);
    eventEmitter.emit('members:reload', undefined);
    await settle(AFTER_THE_WINDOW_MS);
    expect(listMembers).toHaveBeenCalledTimes(2);
    unmount();
  });

  it('does not ask after the page has let go', async () => {
    const unmount: () => void = await mounted();
    eventEmitter.emit('members:reload', undefined);
    unmount();
    await settle(AFTER_THE_WINDOW_MS);
    expect(listMembers).not.toHaveBeenCalled();
  });
});
