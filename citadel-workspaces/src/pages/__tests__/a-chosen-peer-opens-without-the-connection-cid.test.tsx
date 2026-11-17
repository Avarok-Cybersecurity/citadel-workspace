/**
 * Choosing a peer on the Messages page opens the conversation even when the
 * connection's CID is not known.
 *
 * The page gated the chat on `connectionManager.getConnectionInfo()?.cid`, read
 * once at render with nothing to re-render it -- the CONNECTION's identity, not
 * the tab's. When it was empty the chosen peer got "No conversation selected",
 * and on a phone, where the list is hidden once a peer is chosen, that was an
 * empty pane with no way back. `WorkspaceView` renders the same chat from the
 * tab's identity, with the connection only as a fallback.
 *
 * Mocked, each for what it needs that a unit test does not have: the connection
 * and the tab context (a live agent and IndexedDB -- the two inputs under
 * test), the workspace store and registered peers (a session), the app chrome
 * (the whole signed-in layout), and P2PPeerList / P2PChat (live messaging),
 * which are replaced by probes recording what the page hands them. The page's
 * own gating and identity resolution run for real.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const connection: { current: { cid: bigint } | null } = { current: null };
const tab: { current: { selectedUsername: string; selectedCid?: bigint } | null } = { current: null };

vi.mock('@/lib/connection', () => ({
  connectionManager: {
    getConnectionInfo: (): unknown => connection.current,
    getTabSelectedSession: async (): Promise<unknown> => null,
  },
}));
vi.mock('@/lib/tab-context', () => ({
  getSelectedUser: async (): Promise<unknown> => tab.current,
}));
vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: (): unknown => ({ state: { members: [], currentUser: null } }),
}));
vi.mock('@/hooks', () => ({ useRegisteredPeers: (): unknown => ({ registeredPeers: [] }) }));
vi.mock('@/components/layout/AppLayout', () => ({
  AppLayout: ({ children }: { children: React.ReactNode }): JSX.Element => <div>{children}</div>,
}));
vi.mock('@/components/p2p/P2PPeerList', () => ({ P2PPeerList: (): JSX.Element => <div /> }));
vi.mock('@/components/p2p/P2PChat', () => ({
  P2PChat: (props: { currentUserCid?: bigint }): JSX.Element => (
    <div data-testid="chat" data-self={props.currentUserCid?.toString() ?? 'none'} />
  ),
}));

const { default: Messages } = await import('../Messages');

function open(): void {
  render(
    <MemoryRouter initialEntries={['/messages?channel=42']}>
      <Messages />
    </MemoryRouter>,
  );
}

describe('a peer chosen on the Messages page', () => {
  beforeEach((): void => {
    connection.current = null;
    tab.current = null;
  });

  it('opens when only the tab knows who this is', async () => {
    // The second tab in a two-session browser: the connection names nobody.
    tab.current = { selectedUsername: 'bob', selectedCid: 7n };
    open();
    await waitFor((): void => {
      expect(screen.getByTestId('chat').getAttribute('data-self')).toBe('7');
    });
  });

  it('opens when nobody can name this tab yet, rather than claiming nothing is chosen', () => {
    open();
    expect(screen.getByTestId('chat')).toBeTruthy();
    expect(screen.queryByText('No conversation selected')).toBeNull();
  });

  it('falls back to the connection when the tab has no CID', () => {
    connection.current = { cid: 9n };
    open();
    expect(screen.getByTestId('chat').getAttribute('data-self')).toBe('9');
  });

  it("prefers the tab's CID to the connection's, which may be the other tab's", async () => {
    tab.current = { selectedUsername: 'bob', selectedCid: 7n };
    connection.current = { cid: 9n };
    open();
    await waitFor((): void => {
      expect(screen.getByTestId('chat').getAttribute('data-self')).toBe('7');
    });
  });

  it('always offers the way back to the list the phone layout hid', () => {
    open();
    expect(screen.getByRole('button', { name: 'Conversations' })).toBeTruthy();
  });
});
