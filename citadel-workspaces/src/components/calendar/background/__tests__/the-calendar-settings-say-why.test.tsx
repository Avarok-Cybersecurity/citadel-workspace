/**
 * The Calendar's settings outside its tab (Settings -> Notifications) tell a member why the
 * Calendar does not reach them and what to do, from the same view a tab decides (zone-state.ts),
 * never one sentence for every reason. The owner's case: installed workspace-wide, granted the
 * group topics, and not yet answered -- the Calendar asks first; it is not "not available".
 *
 * Real: CalendarNotificationsHere, WithCalendar, AppZonePage and its zone data, usePlacedApp,
 * zoneView and the placeholder. Doubles: the apps transport (the I/O boundary: a server whose
 * answers each case sets), the signed-in workspace state, the permission hook (whether this member
 * may install is an input here), and the runtime (null: these cases never reach it).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AppInstall, AppsRequest } from 'citadel-workspace-client-ts';
import type { AppsAnswer } from '@/lib/citadel-apps/wire/apps-answer';
import { installOf } from '@/test/app-manifests';

const CALENDAR: string = 'net.avarok.calendar';
type Listing = 'listed' | 'refused' | 'silent';
const server: { listing: Listing; installs: AppInstall[]; mayInstall: boolean; asked: number } = vi.hoisted(() => ({ listing: 'listed', installs: [], mayInstall: false, asked: 0 }));

vi.mock('@/lib/citadel-apps/apps-api', async () => {
  const { listingOf: listing } = await import('@/test/app-manifests');
  return {
    sessionAppsTransport: {
      request: async (request: AppsRequest): Promise<AppsAnswer | null> => {
        if (request === 'ListInstalls') return { kind: 'installs', installs: [...server.installs], disabledForMe: [], peerForMe: [] };
        if (typeof request === 'object' && 'GetListing' in request) {
          server.asked++;
          if (server.listing === 'silent') return null;
          if (server.listing === 'refused') return { kind: 'refused', refusal: 'Unavailable' };
          return { kind: 'listing', listing: { ...listing({ id: CALENDAR, name: 'Calendar', surfaces: ['node_tab'] }), source: 'FirstParty' } };
        }
        return { kind: 'refused', refusal: 'Unavailable' };
      },
    },
  };
});
vi.mock('@/contexts/WorkspaceContext', () => ({ useWorkspace: (): unknown => ({ state: { currentUser: { username: 'alice' }, nodes: {} } }) }));
vi.mock('@/hooks/use-permission', () => ({
  usePermission: (): unknown => ({ allowed: server.mayInstall, loading: false, unanswered: false, answered: true }),
}));
vi.mock('@/components/office/app-zone/lazy-runtime', () => ({ pageZoneRuntime: null }));

const { default: CalendarNotificationsHere } = await import('../CalendarNotificationsHere');

const OLD: string = 'The Calendar is not available to you in this workspace.';
const placeholder = async (): Promise<HTMLElement> => screen.findByTestId('app-zone-required');
const state = async (): Promise<string | null> => (await placeholder()).getAttribute('data-zone-state');

describe("the Calendar's settings say why it does not reach you, and what to do", () => {
  beforeEach((): void => { cleanup(); server.listing = 'listed'; server.installs = []; server.mayInstall = false; server.asked = 0; });

  it('installed with group topics and not yet answered: it asks for your OK, answerable here', async () => {
    server.installs = [installOf(CALENDAR, 'Workspace', { id: 'i1', source: 'FirstParty', granted: ['group.topic.subscribe', 'group.topic.publish'] })];
    render(<CalendarNotificationsHere />);
    expect(await state()).toBe('needs-answer');
    expect(screen.getByText('Calendar needs your OK first.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Allow and start Calendar' })).toBeTruthy();
    expect(screen.queryByText(OLD)).toBeNull();
  });

  it('not installed, and you may install: an Install button (control: you may not -- ask an admin)', async () => {
    server.mayInstall = true;
    render(<CalendarNotificationsHere />);
    expect(await state()).toBe('install');
    expect(screen.getByRole('button', { name: 'Install Calendar' })).toBeTruthy();
    cleanup();
    server.mayInstall = false;
    render(<CalendarNotificationsHere />);
    expect(await state()).toBe('ask-admin');
    expect(screen.queryByRole('button', { name: 'Install Calendar' })).toBeNull();
    expect(screen.getByText('Ask a workspace admin to install it.')).toBeTruthy();
  });

  it('installed, but not for you here: says so (control: installed for no one says nothing of it)', async () => {
    server.installs = [installOf(CALENDAR, { SelfOnly: 'bob' }, { id: 'i2', source: 'FirstParty' })];
    render(<CalendarNotificationsHere />);
    expect(await state()).toBe('ask-admin');
    expect(screen.getByText(/It is installed in this workspace, but not for you here\./)).toBeTruthy();
    cleanup();
    server.installs = [];
    render(<CalendarNotificationsHere />);
    expect(await state()).toBe('ask-admin');
    expect(screen.queryByText(/not for you here/)).toBeNull();
  });

  it('not listed for you: not available, with whom to ask, and nothing to press', async () => {
    server.listing = 'refused';
    render(<CalendarNotificationsHere />);
    expect(await state()).toBe('not-available');
    expect(screen.getByText('Ask a workspace admin whether it can be installed for you.')).toBeTruthy();
    expect(within(await placeholder()).queryAllByRole('button')).toHaveLength(0);
  });

  it('installed and reaching you, on a page where apps cannot run: says so', async () => {
    server.installs = [installOf(CALENDAR, 'Workspace', { id: 'i4', source: 'FirstParty' })];
    render(<CalendarNotificationsHere />);
    expect(await state()).toBe('ready-unmounted');
    expect(screen.getByText('Apps cannot run on this page.')).toBeTruthy();
  });

  it('no answer from the server: could not be loaded, and Try again asks again (control: a refusal is not a failure)', async () => {
    server.listing = 'silent';
    render(<CalendarNotificationsHere />);
    expect(await state()).toBe('failed');
    const before: number = server.asked;
    server.listing = 'listed';
    server.mayInstall = true;
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('button', { name: 'Install Calendar' })).toBeTruthy();
    expect(server.asked).toBeGreaterThan(before);
  });
});
