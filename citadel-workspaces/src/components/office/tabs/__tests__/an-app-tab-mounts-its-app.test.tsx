/**
 * An app tab hands a ready install to the page runtime's `mountPane` (never `mount`, which is a
 * zone's), refuses an app whose manifest cannot be a tab, and closes the app with `unmount` when
 * the reader switches to another tab (the panel unmounts).
 *
 * Real: NodeTabs, useNodeTabs, AppTabPane and its hooks, the zone state. Doubles: the runtime (the
 * seam, recording what it is asked), the zone's data port, the chat and call components (they need
 * a live session and are not under test) and the permission hook (its answer is the input here).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AppInstall } from 'citadel-workspace-client-ts';
import { listedApps, type ListedApp } from '@/lib/citadel-apps/listing-model';
import type { CloseReason } from '@/lib/citadel-apps/sdk/generated/CloseReason';
import { forgetAllTabs } from '@/lib/node-tabs/tab-memory';
import { installOf, listingOf } from '@/test/app-manifests';
import { AppZoneContext, zoneClaims, type AppTabMount, type AppZoneEnvironment, type AppZoneHandle, type AppZoneRuntime } from '../../app-zone/app-zone-environment';
import { NO_GLUE } from '../../app-zone/__tests__/doubles/no-tabs';

vi.mock('../../NodeChat', () => ({ NodeChat: (): JSX.Element => <div data-testid="chat-view" /> }));
vi.mock('@/components/call/GroupCallControls', () => ({ GroupCallControls: (): JSX.Element => <div /> }));
vi.mock('@/components/call/GroupCallDock', () => ({ GroupCallDock: (): JSX.Element => <div /> }));
vi.mock('@/hooks/use-domain-call-members', () => ({ useDomainCallMembers: (): unknown => ({ callable: [], notConnected: [] }) }));
vi.mock('@/hooks/use-permission', () => ({ usePermission: (): unknown => ({ allowed: false, loading: false, unanswered: false, answered: true }) }));

const { NodeTabs } = await import('../NodeTabs');
const { useNodeTabs } = await import('../use-node-tabs');
const { AppTabPane } = await import('../../app-zone/AppTabPane');

const APP: string = 'com.acme.kanban';
const AS_TAB: ListedApp = listedApps([listingOf({ id: APP, name: 'Kanban', version: '1.4.0', surfaces: ['node_tab'] })])[0];
const ZONE_ONLY: ListedApp = listedApps([listingOf({ id: APP, name: 'Kanban', version: '1.4.0', surfaces: ['md_zone'] })])[0];
const INSTALL: AppInstall = installOf(APP, 'Workspace', { id: 'i1' });

interface Recording { panes: AppTabMount[]; zones: number; closes: CloseReason[] }

function recordingRuntime(rec: Recording): AppZoneRuntime {
  const handle = (): AppZoneHandle => ({ close: async (reason: CloseReason): Promise<void> => { rec.closes.push(reason); } });
  return {
    mount: (): AppZoneHandle => { rec.zones++; return handle(); },
    mountPane: (_host, tab: AppTabMount): AppZoneHandle => { rec.panes.push(tab); return handle(); },
    bindGlue: NO_GLUE,
  };
}

function env(listing: ListedApp, runtime: AppZoneRuntime): AppZoneEnvironment {
  return {
    nodeId: 'n1', me: 'alice', ancestors: [], mayInstall: 'yes', runtime,
    data: { listing: async () => ({ ok: true, value: listing }), installs: async () => ({ ok: true, value: [INSTALL] }), setDisabledForMe: async (_i: string, d: boolean) => ({ ok: true, value: d }) },
    openLink: () => undefined, linkUrl: () => '', copyText: async () => undefined, ...zoneClaims(),
  };
}

const REFUSING: import('../use-node-tabs').NodeTabsWriter = {
  writeNodeTabs: (): Promise<void> => Promise.reject(new Error('this test writes no tabs')),
  setDefaultAppTabs: (): Promise<void> => Promise.reject(new Error('this test writes no tabs')),
};

function Pane({ zoneEnv }: { zoneEnv: AppZoneEnvironment }): JSX.Element {
  const model: import('../use-node-tabs').NodeTabsModel = useNodeTabs({ nodeId: 'n1', chatEnabled: false, nodeMetadata: { app_tabs: [APP] }, workspaceMetadata: { default_app_tabs: [] }, writer: REFUSING });
  return (
    <AppZoneContext.Provider value={zoneEnv}>
      <NodeTabs
        model={model} contentView={<div data-testid="the-page" />} chatChannelId={null} nodeId="n1" roomName="Platform"
        currentUserId="1" currentUserName="alice" currentUserCid={1n} rules={null} onAdd={null}
        appPanel={(appId: string): JSX.Element => <AppTabPane appId={appId} tabId={appId} />}
      />
    </AppZoneContext.Provider>
  );
}

describe('an app tab', () => {
  beforeEach((): void => { cleanup(); forgetAllTabs(); });

  it('mounts its app as a tab, and switching away closes it with unmount', async () => {
    const rec: Recording = { panes: [], zones: 0, closes: [] };
    render(<Pane zoneEnv={env(AS_TAB, recordingRuntime(rec))} />);
    await userEvent.click(screen.getByRole('tab', { name: 'Kanban' }));
    await waitFor(() => expect(rec.panes).toHaveLength(1));
    expect(rec.panes[0]).toMatchObject({ tabId: APP, nodeId: 'n1', me: 'alice', install: { id: 'i1' } });
    expect(rec.zones).toBe(0);
    expect(screen.getByTestId('app-tab-host')).toBeTruthy();
    await userEvent.click(screen.getByRole('tab', { name: 'Page' }));
    await waitFor(() => expect(rec.closes).toEqual(['unmount']));
  });

  it('an app that cannot be a tab is refused before anything mounts (control: one that can is mounted)', async () => {
    const rec: Recording = { panes: [], zones: 0, closes: [] };
    render(<Pane zoneEnv={env(ZONE_ONLY, recordingRuntime(rec))} />);
    await userEvent.click(screen.getByRole('tab', { name: 'Kanban' }));
    await waitFor(() => expect(screen.getByTestId('app-zone-required').dataset.zoneState).toBe('wrong-surface'));
    expect(screen.getByTestId('app-zone-required').textContent).toContain('Kanban cannot be shown in a tab.');
    expect([rec.panes.length, rec.zones]).toEqual([0, 0]);
  });
});
