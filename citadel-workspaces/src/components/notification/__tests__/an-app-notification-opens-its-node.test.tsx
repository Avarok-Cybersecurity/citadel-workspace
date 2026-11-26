/**
 * An app's notification is a control: activating its card in the panel opens the node the app's
 * instance is mounted on (lib/citadel-apps/app-notices.ts asks, use-app-notice-opener.ts opens it
 * the way a node is opened, `useSelectNode`) and closes the panel. The notification is the one
 * `pageAppNotices` really adds to the page's list; the router is a MemoryRouter whose location is
 * read back.
 *
 * `getCurrentCid` is replaced: which session a tab acts as is read from the connection and
 * IndexedDB, which this test does not run.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation, type Location } from 'react-router-dom';
import { ConfirmDialogProvider } from '@/components/shared/confirm-dialog';
import { notificationService } from '@/lib/notification-service/service';
import type { Notification } from '@/lib/notification-service/types';
import { pageAppNotices } from '@/lib/citadel-apps/app-notices';
import NotificationItem from '../NotificationItem';
import { useAppNoticeOpener } from '../use-app-notice-opener';

vi.mock('@/lib/p2p/current-cid', () => ({ getCurrentCid: async (): Promise<bigint | null> => 42n }));

const settle = (): Promise<void> => new Promise<void>((r) => setTimeout(r, 0));

function Where(): JSX.Element {
  const location: Location = useLocation();
  return <output data-testid="where">{`${location.pathname}${location.search}`}</output>;
}

function Opener({ onClose }: { onClose: () => void }): null {
  useAppNoticeOpener(onClose);
  return null;
}

describe("an app's notification card", () => {
  it('opens the node its app is mounted on, and closes the panel', async () => {
    pageAppNotices({ from: 'synchronized.work', appId: 'work.synchronized', nodeId: 'n-7', title: 'Build finished', body: 'ana: tests green', senderLine: 'x: new notice' });
    await settle();
    const raised: Notification | undefined = notificationService.getNotificationsForCid('42').find((n: Notification) => n.title === 'Build finished');
    if (raised === undefined) throw new Error('the notification was not added');
    const onClose = vi.fn<() => void>();
    render(
      <ConfirmDialogProvider>
        <MemoryRouter initialEntries={['/workspace?nodeId=n-1&showP2P=true']}>
          <Where />
          <Opener onClose={onClose} />
          <NotificationItem notification={raised} />
        </MemoryRouter>
      </ConfirmDialogProvider>,
    );
    await userEvent.click(screen.getByText('Build finished'));
    await vi.waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/workspace?nodeId=n-7'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
