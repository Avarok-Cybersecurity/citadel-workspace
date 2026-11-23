/**
 * The Calendar's tab, where a member opens it, asks its open question there -- its name and the
 * question's words from the manifest and the consent copy, never per app -- and answering sends
 * the same operation the Installed panel does (`SetPeerConsentForMe`), after which it is ready.
 * And the tab and the Calendar's settings show the same placeholder for each state, because both
 * draw `zoneView` through `placeholderFor` and AppZoneRequired.
 *
 * Real: AppTabPane, CalendarNotificationsHere, WithCalendar, AppZonePage and its zone data,
 * usePlacedApp, zoneView, the placeholder and the peer-answer store. Doubles: the apps transport
 * (the I/O boundary: a server holding installs and this member's answers), the signed-in
 * workspace state, the permission hook (whether this member may install is an input), and the
 * runtime (null: whether apps can run is an input, and none runs here).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AppInstall, AppsRequest, PeerConsent, PeerForMe } from 'citadel-workspace-client-ts';
import type { AppsAnswer } from '@/lib/citadel-apps/wire/apps-answer';
import type { PeerAnswer } from '@/lib/citadel-apps/wire/apps-peer-answer';
import { adoptPeerForMe } from '@/lib/citadel-apps/peer-for-me';
import { installOf } from '@/test/app-manifests';

const CALENDAR: string = 'net.avarok.calendar';
type Listing = 'listed' | 'refused' | 'silent';
interface Server { listing: Listing; installs: AppInstall[]; peerForMe: PeerForMe[]; mayInstall: boolean; answers: AppsRequest[] }
const server: Server = vi.hoisted((): Server => ({ listing: 'listed', installs: [], peerForMe: [], mayInstall: false, answers: [] }));

vi.mock('@/lib/citadel-apps/apps-api', async () => {
  const { listingOf: listing } = await import('@/test/app-manifests');
  return {
    sessionAppsTransport: {
      request: async (request: AppsRequest): Promise<AppsAnswer | PeerAnswer | null> => {
        if (request === 'ListInstalls') return { kind: 'installs', installs: [...server.installs], disabledForMe: [], peerForMe: [...server.peerForMe] };
        if (typeof request === 'object' && 'SetPeerConsentForMe' in request) {
          server.answers.push(request);
          const { install_id, serve, call, topics } = request.SetPeerConsentForMe;
          const consent: PeerConsent = { serve, call, topics, at_ms: 7n };
          server.peerForMe = [{ install_id, consent, blocked: [] }];
          return { kind: 'peer-consent', installId: install_id, consent };
        }
        if (typeof request === 'object' && 'GetListing' in request) {
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
vi.mock('@/hooks/use-permission', () => ({ usePermission: (): unknown => ({ allowed: server.mayInstall, loading: false, unanswered: false, answered: true }) }));
vi.mock('@/components/office/app-zone/lazy-runtime', () => ({ pageZoneRuntime: null }));

const { AppZonePage } = await import('@/components/office/app-zone/AppZonePage');
const { AppTabPane } = await import('@/components/office/app-zone/AppTabPane');
const { default: CalendarNotificationsHere } = await import('../CalendarNotificationsHere');
const { WORKSPACE_ROOT_ID } = await import('@/lib/workspace-constants');

const TOPICS: AppInstall['granted'] = ['group.topic.subscribe', 'group.topic.publish'];
const tab = (): JSX.Element => <AppZonePage nodeId={WORKSPACE_ROOT_ID} runtime={null}><AppTabPane appId={CALENDAR} tabId="calendar" /></AppZonePage>;

/** What a placeholder says and offers: its state, its words, and its buttons. */
interface Shown { state: string | null; text: string; buttons: string[] }

async function shown(): Promise<Shown> {
  const el: HTMLElement = await waitFor((): HTMLElement => {
    const found: HTMLElement = screen.getByTestId('app-zone-required');
    expect(found.getAttribute('data-zone-state')).not.toBe('loading');
    return found;
  });
  return { state: el.getAttribute('data-zone-state'), text: el.textContent ?? '', buttons: within(el).queryAllByRole('button').map((b: HTMLElement) => b.textContent ?? '') };
}

describe("the Calendar's tab asks in place, and says what its settings say", () => {
  beforeEach((): void => {
    cleanup();
    Object.assign(server, { listing: 'listed', installs: [], peerForMe: [], mayInstall: false, answers: [] });
    adoptPeerForMe([]);
  });

  it('asks for the OK to join its channels, sends the answer, and is then ready (control: before it, not ready)', async () => {
    server.installs = [installOf(CALENDAR, 'Workspace', { id: 'cal', source: 'FirstParty', granted: TOPICS })];
    render(tab());
    const before: Shown = await shown();
    expect(before.state).toBe('needs-answer');
    expect(before.text).toContain('Calendar needs your OK first.');
    expect(within(screen.getByTestId('app-zone-question')).getByText('Join this app’s channels')).toBeTruthy();
    expect(server.answers).toHaveLength(0);
    await userEvent.click(screen.getByRole('button', { name: 'Allow and start Calendar' }));
    expect(server.answers).toEqual([{ SetPeerConsentForMe: { install_id: 'cal', serve: false, call: false, topics: true } }]);
    // Ready: with no runtime on this page, the ready placeholder, and the question gone.
    expect((await screen.findByTestId('app-zone-required')).getAttribute('data-zone-state')).toBe('ready-unmounted');
    expect(screen.queryByTestId('app-zone-question')).toBeNull();
  });

  it('"Start without it" answers no to the open question, and starts too', async () => {
    server.installs = [installOf(CALENDAR, 'Workspace', { id: 'cal', source: 'FirstParty', granted: TOPICS })];
    render(tab());
    await shown();
    await userEvent.click(screen.getByRole('button', { name: 'Start without it' }));
    expect(server.answers).toEqual([{ SetPeerConsentForMe: { install_id: 'cal', serve: false, call: false, topics: false } }]);
    expect((await screen.findByTestId('app-zone-required')).getAttribute('data-zone-state')).toBe('ready-unmounted');
  });

  const STATES: [string, () => void][] = [
    ['needs-answer', (): void => { server.installs = [installOf(CALENDAR, 'Workspace', { id: 'cal', source: 'FirstParty', granted: TOPICS })]; }],
    ['install', (): void => { server.mayInstall = true; }],
    ['ask-admin', (): void => { server.mayInstall = false; }],
    ['ask-admin', (): void => { server.installs = [installOf(CALENDAR, { SelfOnly: 'bob' }, { id: 'bobs', source: 'FirstParty' })]; }],
    ['failed', (): void => { server.listing = 'silent'; }],
    ['not-available', (): void => { server.listing = 'refused'; }],
    ['ready-unmounted', (): void => { server.installs = [installOf(CALENDAR, 'Workspace', { id: 'cal', source: 'FirstParty' })]; }],
  ];

  it.each(STATES)('the tab and the settings agree: %s', async (want: string, arrange: () => void) => {
    arrange();
    render(tab());
    const inTab: Shown = await shown();
    cleanup();
    adoptPeerForMe([]);
    render(<CalendarNotificationsHere />);
    const inSettings: Shown = await shown();
    expect(inTab.state).toBe(want);
    expect(inSettings.state).toBe(want);
    expect(inSettings.buttons).toEqual(inTab.buttons);
    // The words differ only where they name the place ("this tab" / "this setting").
    expect(inSettings.text.replaceAll('setting', 'PLACE')).toBe(inTab.text.replaceAll('tab', 'PLACE'));
  });
});
