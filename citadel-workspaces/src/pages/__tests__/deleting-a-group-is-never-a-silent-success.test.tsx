/**
 * "Delete Group" must either send the delete or tell the user why it did not.
 *
 * `onDeleteGroup` returned early when the page's `currentUserId` was empty --
 * the connection CID as the page read it at render, which a tab can lack, and
 * which nothing re-reads when it arrives. The early return resolved the
 * promise, the settings panel closed on it, and nothing was sent or shown: the
 * group went on existing for everyone while the owner believed it was gone.
 *
 * Only the two I/O edges are replaced: the connection read (whether this tab
 * has a CID is the whole subject) and the WebSocket send. `sendGroupEnd`, its
 * CID resolution and the hook's error handling all run for real.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useGroupSettingsActions, type GroupSettingsActions } from '../use-group-settings-actions';
import { connectionManager } from '@/lib/connection';
import { websocketService } from '@/lib/websocket-service';
import type { CurrentConnectionInfo } from '@/lib/connection/types';

interface Toast { title: string; description?: string; variant?: 'destructive' }

const GROUP: string = '5:9';

let toasts: Toast[];
let navigate: ReturnType<typeof vi.fn>;
let sent: Array<Record<string, unknown>>;

function actions(): GroupSettingsActions {
  return renderHook((): GroupSettingsActions => useGroupSettingsActions({
    groupId: GROUP,
    setGroup: vi.fn(),
    navigate,
    toast: (t: Toast): void => { toasts.push(t); },
  })).result.current;
}

function connectedAs(info: CurrentConnectionInfo | null): void {
  vi.spyOn(connectionManager, 'getConnectionInfo').mockReturnValue(info);
}

beforeEach(() => {
  toasts = [];
  sent = [];
  navigate = vi.fn();
  vi.spyOn(websocketService, 'sendMessage').mockImplementation(async (m: Record<string, unknown>): Promise<void> => {
    sent.push(m);
  });
});

afterEach(() => { vi.restoreAllMocks(); });

describe('deleting a group', () => {
  it('sends the delete once the tab knows its CID, whatever the page rendered with', async () => {
    connectedAs({ cid: 5n });
    await actions().onDeleteGroup();

    expect(sent).toEqual([
      { GroupEnd: { cid: 5n, group_key: { cid: 5n, mgid: 9n }, request_id: expect.any(String) } },
    ]);
    expect(navigate).toHaveBeenCalledWith('/workspace');
    expect(toasts).toEqual([]);
  });

  it('tells the user when it cannot be sent, and stays on the group', async () => {
    connectedAs(null);
    await actions().onDeleteGroup();

    expect(sent).toEqual([]);
    expect(navigate).not.toHaveBeenCalled();
    expect(toasts).toEqual([
      { title: 'Failed to delete group', description: 'Not connected to server', variant: 'destructive' },
    ]);
  });
});
