/**
 * Window 2 of an account leaves the workspace for the landing page, saying
 * why, when window 1 signs the account out or deletes it -- and asks first
 * when its editor holds unsaved text. Another account's ending changes nothing.
 *
 * Stood in: the tab's stored selection (IndexedDB) and the toast. The router,
 * the confirm dialog, the editor guard and the watcher are production code.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const toasts: string[] = vi.hoisted(() => []);
vi.mock('@/hooks/use-toast', () => ({
  useToast: (): { toast: (t: { description: string }) => void } => ({ toast: ({ description }: { description: string }): void => { toasts.push(description); } }),
}));
vi.mock('@/lib/tab-context', () => ({
  getSelectedUser: async (): Promise<{ selectedCid: bigint; selectedUsername: string }> => ({ selectedCid: 7n, selectedUsername: 'alice' }),
}));

import { SessionEndedWatcher } from '../SessionEndedWatcher';
import { ConfirmDialogProvider } from '@/components/shared/confirm-dialog';
import { eventEmitter } from '@/lib/event-emitter';
import { registerUnsavedEdits, clearUnsavedEditsForTests } from '@/lib/unsaved-edits';

function app(): void {
  render(
    <MemoryRouter initialEntries={['/office']}>
      <ConfirmDialogProvider>
        <SessionEndedWatcher />
        <Routes>
          <Route path="/" element={<p>the landing page</p>} />
          <Route path="/office" element={<p>the workspace</p>} />
        </Routes>
      </ConfirmDialogProvider>
    </MemoryRouter>,
  );
}

const signedOut = (cid: bigint): void => {
  act(() => { eventEmitter.emit('websocket-message', { DisconnectNotification: { cid, peer_cid: null, request_id: null } }); });
};

beforeEach(() => { toasts.length = 0; clearUnsavedEditsForTests(); });

describe('a window whose session ended elsewhere', () => {
  it('goes to the landing page and says the account was signed out in another window', async () => {
    app();
    signedOut(7n);
    expect(await screen.findByText('the landing page')).toBeInTheDocument();
    expect(toasts).toEqual(['alice was signed out in another window.']);
  });

  it('says it was deleted, for a deletion', async () => {
    app();
    act(() => { eventEmitter.emit('websocket-message', { DeregisterSuccess: { cid: 7n, request_id: null } }); });
    expect(await screen.findByText('the landing page')).toBeInTheDocument();
    expect(toasts).toEqual(['alice was deleted in another window.']);
  });

  it('asks first when the editor holds unsaved text, and stays if told to', async () => {
    registerUnsavedEdits('editor-1');
    app();
    signedOut(7n);
    fireEvent.click(await screen.findByRole('button', { name: /cancel/i }));
    await vi.waitFor(() => expect(toasts[0]).toMatch(/^alice was signed out in another window\. Your unsaved text is still here/));
    expect(screen.getByText('the workspace')).toBeInTheDocument();
  });

  it('ignores another account ending', async () => {
    app();
    signedOut(8n);
    signedOut(7n);
    expect(await screen.findByText('the landing page')).toBeInTheDocument();
    expect(toasts).toEqual(['alice was signed out in another window.']);
  });
});
