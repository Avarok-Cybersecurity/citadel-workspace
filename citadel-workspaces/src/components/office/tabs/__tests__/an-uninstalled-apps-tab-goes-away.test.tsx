/**
 * An app's tab is shown only while an install of it reaches this person here: uninstalled, it
 * leaves the row at once -- from this tab's own answer, from another tab of the account (the same
 * frame, routed to every tab holding the session: multi-instance/__tests__/an-apps-answer-reaches-
 * every-tab-of-the-account.test.ts) and from the server's notice to other members -- and the
 * reader is put back on the page. Installed again, the tab comes back where the list keeps it.
 *
 * Real: NodePane, AppZonePage and its reaction to `workspace:apps`, the zone data, useNodeTabs,
 * the row and the app pane. Doubles: the apps transport (the I/O boundary: a server holding a
 * mutable install list), the signed-in workspace state, the permission hook (its answer is an
 * input here), the runtime (null: nothing runs, the pane shows its placeholder), and the chat and
 * call components, which need a live session and are not under test.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AppInstall, AppsRequest } from 'citadel-workspace-client-ts';
import type { AppsAnswer } from '@/lib/citadel-apps/wire/apps-answer';
import { eventEmitter } from '@/lib/event-emitter';
import { forgetAllTabs } from '@/lib/node-tabs/tab-memory';
import { installOf } from '@/test/app-manifests';

const CALENDAR: string = 'net.avarok.calendar';
const server: { installs: AppInstall[]; answered: number } = vi.hoisted(() => ({ installs: [], answered: 0 }));

vi.mock('@/lib/citadel-apps/apps-api', async () => {
  const { listingOf: listing } = await import('@/test/app-manifests');
  return {
    sessionAppsTransport: {
      request: async (request: AppsRequest): Promise<AppsAnswer> => {
        if (request === 'ListInstalls') {
          server.answered++;
          return { kind: 'installs', installs: [...server.installs], disabledForMe: [], peerForMe: [] };
        }
        if (typeof request === 'object' && 'GetListing' in request) {
          return { kind: 'listing', listing: { ...listing({ id: CALENDAR, name: 'Calendar', surfaces: ['node_tab'] }), source: 'FirstParty' } };
        }
        return { kind: 'refused', refusal: 'Unavailable' };
      },
    },
  };
});
vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: (): unknown => ({ state: { currentUser: { username: 'alice' }, nodes: {}, workspace: { metadata: { default_app_tabs: ['net.avarok.calendar'] } } } }),
}));
vi.mock('@/hooks/use-permission', () => ({ usePermission: (): unknown => ({ allowed: false, loading: false, unanswered: false, answered: true }) }));
vi.mock('../../app-zone/lazy-runtime', () => ({ pageZoneRuntime: null }));
vi.mock('../../NodeChat', () => ({ NodeChat: (): JSX.Element => <div data-testid="chat-view" /> }));
vi.mock('@/components/call/GroupCallControls', () => ({ GroupCallControls: (): JSX.Element => <div /> }));
vi.mock('@/components/call/GroupCallDock', () => ({ GroupCallDock: (): JSX.Element => <div /> }));
vi.mock('@/hooks/use-domain-call-members', () => ({ useDomainCallMembers: (): unknown => ({ callable: [], notConnected: [] }) }));

const { NodePane } = await import('../NodePane');

const CHAT: { enabled: true; channelId: string } = { enabled: true, channelId: 'ch-1' };

function Pane(): JSX.Element {
  return (
    <NodePane
      nodeId="n1" node={null} chat={CHAT} contentView={<div data-testid="the-page" />} roomName="Platform"
      reader={{ id: '1', displayName: 'alice' }} readerCid={1n}
    />
  );
}

const told = (answer: unknown): void => act((): void => { eventEmitter.emit('workspace:apps', { answer }); });
const calendarTab = (): HTMLElement | null => screen.queryByRole('tab', { name: 'Calendar' });

describe('an app tab follows its install', () => {
  beforeEach((): void => { cleanup(); forgetAllTabs(); server.installs = [installOf(CALENDAR, 'Workspace', { id: 'i1', source: 'FirstParty' })]; server.answered = 0; });

  it('leaves the row when its app is uninstalled, puts the reader on the page, and comes back on a reinstall', async () => {
    render(<Pane />);
    // First that it is there, open: a tab that never appeared would pass the absence below.
    await userEvent.click(await screen.findByRole('tab', { name: 'Calendar' }));
    expect(calendarTab()?.getAttribute('aria-selected')).toBe('true');

    server.installs = [];
    told({ Uninstalled: { install_id: 'i1' } });
    await waitFor(() => expect(calendarTab()).toBeNull());
    expect(screen.getByRole('tab', { name: 'Page' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('the-page')).toBeTruthy();

    server.installs = [installOf(CALENDAR, 'Workspace', { id: 'i2', source: 'FirstParty' })];
    told('InstallsChanged');
    expect(await screen.findByRole('tab', { name: 'Calendar' })).toBeTruthy();
  });

  it('control: an answer that changes no install leaves the tab where it is', async () => {
    render(<Pane />);
    await screen.findByRole('tab', { name: 'Calendar' });
    server.installs = [];
    told('PeerAnswersChanged');
    // The re-read that would hide it is not made; the row still holds the tab after the event.
    await act(async (): Promise<void> => { await Promise.resolve(); });
    expect(calendarTab()).not.toBeNull();
  });

  it('an install that does not reach this person here does not give the page its tab', async () => {
    server.installs = [installOf(CALENDAR, { SelfOnly: 'bob' }, { id: 'i3' })];
    render(<Pane />);
    // Until the installs answer, the stored tab shows; the absence is read only after they have.
    expect(calendarTab()).not.toBeNull();
    await waitFor(() => expect(server.answered).toBeGreaterThan(0));
    await waitFor(() => expect(calendarTab()).toBeNull());
  });
});
