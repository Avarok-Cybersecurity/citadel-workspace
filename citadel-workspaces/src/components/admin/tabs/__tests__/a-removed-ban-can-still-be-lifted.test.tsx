/**
 * A banned member removed from the workspace is on no roster, so the Banned section lists every
 * banned account the server names and offers Unban on each; a reader without RemoveUsers is not
 * asked about, and is shown, nothing. Real: the response handler that reads the server's reply,
 * the event bus and the section. The workspace service is the only stand-in: it is the wire, and
 * the reply arrives through the handler as the server's does.
 */
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { User, WorkspaceProtocolResponse } from 'citadel-workspace-client-ts';

const listBanned: Mock<() => Promise<void>> = vi.hoisted(() => vi.fn(async (): Promise<void> => {}));
vi.mock('@/lib/workspace-service', () => ({ default: { listBanned } }));

const { handleGeneratedVariants } = await import('@/lib/workspace-response-handler/generated-variant-handlers');
const { eventEmitter } = await import('@/lib/event-emitter');
const { BannedSection } = await import('../BannedSection');

const banned = (id: string, name: string): User => ({ id, name, banned: true, workspace_roles: {}, permissions: {}, metadata: {} });

function reply(members: User[]): void {
  const response: WorkspaceProtocolResponse = { BannedMembers: { members } };
  act(() => { handleGeneratedVariants(response, { cid: 1, request_id: 'r' }); });
}

afterEach(() => { cleanup(); listBanned.mockClear(); });

describe('the Banned section', () => {
  it('lists a removed, banned member the server names, and lifts the ban', async () => {
    const onUnban: Mock = vi.fn();
    render(<BannedSection allowed onUnban={onUnban} />);
    expect(listBanned).toHaveBeenCalledTimes(1);
    reply([banned('mal', 'Mallory')]);
    expect(screen.getByRole('heading', { name: 'Banned' })).toBeTruthy();
    expect(screen.getByTestId('banned-mal').textContent).toContain('Mallory');
    await userEvent.click(screen.getByRole('button', { name: 'Unban mal' }));
    expect(onUnban).toHaveBeenCalledWith(expect.objectContaining({ userId: 'mal', username: 'mal', banned: true }));
  });

  it('asks again once a member write lands, and says so when no one is banned', () => {
    render(<BannedSection allowed onUnban={vi.fn()} />);
    reply([banned('mal', 'Mallory')]);
    act(() => { eventEmitter.emit('members:reload', undefined); });
    expect(listBanned).toHaveBeenCalledTimes(2);
    reply([]);
    expect(screen.queryByTestId('banned-mal')).toBeNull();
    expect(screen.getByText('No one is banned')).toBeTruthy();
  });

  it('asks nothing and shows nothing to a reader without RemoveUsers', () => {
    render(<BannedSection allowed={false} onUnban={vi.fn()} />);
    reply([banned('mal', 'Mallory')]);
    expect(listBanned).not.toHaveBeenCalled();
    expect(screen.queryByTestId('banned-section')).toBeNull();
  });
});
