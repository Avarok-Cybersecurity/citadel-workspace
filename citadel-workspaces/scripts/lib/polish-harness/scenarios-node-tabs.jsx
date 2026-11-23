/**
 * A node pane's tab row at its fullest: page, chat and the most app tabs a node may have, with long
 * names; and the marketplace's tab view ("+") with long names on a long page name.
 *
 * `node-tabs-uninstall`: the real tab model (useNodeTabs) over stored tabs naming the Calendar. The
 * two buttons above it stand in for the server: they replace the installs the page holds, as the
 * re-read after a `workspace:apps` event does.
 */
import { useMemo, useState } from 'react';
import { NodeTabs } from '@/components/office/tabs/NodeTabs';
import { deriveTabList } from '@/lib/node-tabs/tab-list';
import { DEFAULT_APP_TABS_KEY, MAX_APP_TABS } from '@/lib/node-tabs/tab-keys';
import { INSTALLS_UNKNOWN, shownTabs } from '@/lib/node-tabs/installed-tabs';
import { useNodeTabs } from '@/components/office/tabs/use-node-tabs';
import { WorkspaceProvider } from '@/contexts/WorkspaceContext';
import { PermissionsProvider } from '@/contexts/PermissionsContext';
import { AppsBrowse } from '@/components/citadel-apps/marketplace/AppsBrowse';
import { listedApps } from '@/lib/citadel-apps/listing-model';
import manifestCases from '../../../../apps/catalogue/fixtures/manifest-cases.json';

const STATE = { members: {}, currentUser: { id: 'me', username: 'me', name: 'Me' }, nodes: {}, treeSchema: null, loading: { workspace: false, members: false, nodes: false } };

/** The two contexts the pane reads (who may change its tabs); nothing else is wrapped around it. */
const Shell = ({ children }) => <WorkspaceProvider state={STATE}><PermissionsProvider>{children}</PermissionsProvider></WorkspaceProvider>;

const APPS = ['net.avarok.calendar', 'com.acme.kanban', 'com.acme.roadmap-planner', 'org.example.retrospectives', 'com.acme.incident-board', 'io.example.whiteboard', 'com.acme.okr-tracker', 'net.example.standup-notes'].slice(0, MAX_APP_TABS);

function Pane({ apps, workspace }) {
  const [active, setActive] = useState('content');
  const list = deriveTabList({ chatEnabled: true, node: apps === null ? { kind: 'absent' } : { kind: 'list', appIds: apps }, workspace });
  // No installs here: the row at its fullest, every stored tab shown (installed-tabs.ts).
  const model = { list, tabs: shownTabs(list.tabs, INSTALLS_UNKNOWN), active, select: setActive, canConfigure: true, canSetDefault: true, busy: false, change: async () => true };
  return (
    <Shell>
    <div style={{ height: 480 }} className="flex w-full min-w-0 flex-col border border-border" data-testid="node-tabs-pane">
      <NodeTabs
        model={model}
        contentView={<div data-testid="node-tabs-page" className="p-[16px]">The page</div>}
        chatChannelId={null}
        nodeId="n1"
        roomName="Platform"
        currentUserId="1"
        currentUserName="alice"
        currentUserCid={1n}
        rules={null}
        appPanel={(appId) => <div data-testid={`node-tabs-panel-${appId}`} className="p-[16px]">{appId}</div>}
        onAdd={() => {}}
      />
    </div>
    </Shell>
  );
}

const CALENDAR = 'net.avarok.calendar';
const INSTALLED = [{ id: 'i1', app_id: CALENDAR, version: '0.1.0', scope: 'Workspace' }];
const WORKSPACE_TABS = { [DEFAULT_APP_TABS_KEY]: [CALENDAR] };
const WRITER = { writeNodeTabs: async () => undefined, setDefaultAppTabs: async () => undefined };

function UninstallPane() {
  const [installs, setInstalls] = useState(INSTALLED);
  const here = useMemo(() => ({ kind: 'known', installs, me: 'me', nodeId: 'n1', ancestors: [] }), [installs]);
  const model = useNodeTabs({ nodeId: 'n1', chatEnabled: true, nodeMetadata: undefined, workspaceMetadata: WORKSPACE_TABS, here, writer: WRITER });
  const server = (label, testId, next) => <button type="button" className="min-h-[44px] rounded border border-border px-[12px]" data-testid={testId} onClick={() => setInstalls(next)}>{label}</button>;
  return (
    <>
      <div className="flex gap-[8px] p-[8px]">{server('Server: uninstall', 'harness-uninstall', [])}{server('Server: install again', 'harness-reinstall', INSTALLED)}</div>
      <div style={{ height: 420 }} className="flex w-full min-w-0 flex-col border border-border" data-testid="node-tabs-pane">
        <NodeTabs model={model} contentView={<div data-testid="node-tabs-page" className="p-[16px]">The page</div>} chatChannelId={null} nodeId="n1" roomName="Platform"
          currentUserId="1" currentUserName="me" currentUserCid={1n} rules={null}
          appPanel={(appId) => <div data-testid={`node-tabs-panel-${appId}`} className="p-[16px]">{appId}</div>} onAdd={null} />
      </div>
    </>
  );
}

const listing = (id, name, categories) => {
  const m = { ...structuredClone(manifestCases.base), id, name, categories, surfaces: ['node_tab'], summary: `${name}: everything the team plans together, on this page and every page below it` };
  return { source: { WorkspaceRegistry: { entry_id: id } }, manifest_bytes: Array.from(new TextEncoder().encode(JSON.stringify(m))), signature: '0'.repeat(6618) };
};
const FOR_TAB = listedApps([
  listing('net.avarok.calendar', 'Calendar', ['planning']),
  listing('com.acme.kanban', 'Kanban boards for long-running programmes', ['productivity']),
  listing('org.example.retros', 'Retrospectives', ['communication']),
]);
const install = { id: 'k', app_id: 'com.acme.kanban', version: '1.0.0', scope: 'Workspace' };
const DATA = { loading: false, apps: FOR_TAB, installs: [install], globalProblem: null, serverProblem: null, reload: () => {}, recordInstall: () => {}, forgetInstall: () => {}, recordListing: () => {} };
const TAB = {
  reach: { me: 'me', nodeId: 'n1', ancestors: [], installs: [install], tabs: [] },
  nodeName: 'Platform engineering and site reliability, Europe, Middle East and Africa', adding: null, add: () => {}, installAndAdd: () => {},
};

export const NODE_TAB_SCENARIOS = {
  'apps-for-tab': () => <div className="p-[16px]"><AppsBrowse data={DATA} origin="workspace" onOpen={() => {}} tab={TAB} /></div>,
  'node-tabs-full': () => <Pane apps={APPS} workspace={{ kind: 'list', appIds: [] }} />,
  'node-tabs-no-default': () => <Pane apps={null} workspace={{ kind: 'absent' }} />,
  'node-tabs-uninstall': () => <Shell><UninstallPane /></Shell>,
};
