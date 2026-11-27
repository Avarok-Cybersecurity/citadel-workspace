/**
 * An app tab as a workspace page shows it: the shipped OfficeLayout under a 3.5rem stand-in for the
 * app's header (the height the layout subtracts), its NodePane's tabs (NodeTabs), and the Calendar
 * mounted by the real AppTabPane through the first-party registry, over the seeded glue instance
 * (scenarios-calendar.jsx). Only the inputs are stood in for: the zone environment's data (the
 * Calendar's own manifest, one workspace install) and a runtime whose glue half hands over that
 * instance. What decides whether a tall panel scrolls or is clipped is all shipped code.
 */
import { useMemo } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { OfficeLayout } from '@/components/office/OfficeLayout';
import { NodeTabs } from '@/components/office/tabs/NodeTabs';
import { useNodeTabs } from '@/components/office/tabs/use-node-tabs';
import { AppTabPane } from '@/components/office/app-zone/AppTabPane';
import { AppZoneContext, zoneClaims } from '@/components/office/app-zone/app-zone-environment';
import { INSTALLS_UNKNOWN } from '@/lib/node-tabs/installed-tabs';
import { listedApps } from '@/lib/citadel-apps/listing-model';
import { WorkspaceProvider } from '@/contexts/WorkspaceContext';
import { PermissionsProvider } from '@/contexts/PermissionsContext';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ConfirmDialogProvider } from '@/components/shared/confirm-dialog';
import { VIEWER } from '@/lib/calendar/__tests__/placement-fixture';
import calendarManifest from '../../../../apps/first-party/calendar/manifest.json';
import { TREE, seededGlue, useCalendarEngine } from './scenarios-calendar.jsx';
import { workspaceState } from './workspace-state';
import { offerTopicRetry, showTopicJoin } from '@/lib/citadel-apps/topic-join-store';

const CALENDAR = calendarManifest.id;
/** @type {import('citadel-workspace-client-ts').Capability[]} */
const GRANTED = ['storage.user', 'storage.node', 'storage.node.authored', 'nodes.read'];
/** @type {import('citadel-workspace-client-ts').AppInstall} */
const INSTALL = {
  id: 'cal', app_id: CALENDAR, version: calendarManifest.version, manifest_sha256: '1'.repeat(64), artifact_sha256: '0'.repeat(64),
  pinned_publisher_key: 'ab'.repeat(1952), scope: 'Workspace', granted: GRANTED,
  details: { host_network_hosts: [], server_network_hosts: [], ihttp_routes: [], ihttp_call_targets: [], ihttp_p2p_routes: [], topics: [] },
  installed_by: VIEWER, installed_at_ms: 1n, state: 'Active', previous: null, injected_header_into: [], source: { Global: { catalogue_version: 1n } },
};
const LISTED = listedApps([{
  source: { WorkspaceRegistry: { entry_id: CALENDAR } },
  manifest_bytes: new TextEncoder().encode(JSON.stringify(calendarManifest)),
  signature: '0'.repeat(6618),
}])[0];
const STATE = workspaceState({ currentUser: { id: VIEWER, username: VIEWER, name: VIEWER }, nodes: TREE, workspace: { id: 'w', name: 'Workspace', metadata: [] } });
const REFUSE = () => { throw new Error('this scenario mounts the Calendar only'); };
const NO_WRITES = { writeNodeTabs: async () => undefined, setDefaultAppTabs: async () => undefined };

/**
 * @param {import('@/lib/citadel-apps/host/glue-instance').GlueInstance} glue
 * @returns {import('@/components/office/app-zone/app-zone-environment').AppZoneEnvironment}
 */
function environment(glue) {
  /** @type {import('@/components/office/app-zone/app-zone-environment').GlueBound} */
  const ready = { kind: 'bound', instance: glue };
  /** @type {import('@/components/office/app-zone/app-zone-environment').GlueHandle} */
  const bound = { ready: Promise.resolve(ready), close: async () => undefined };
  return {
    nodeId: 'n1', me: VIEWER, ancestors: ['company'], mayInstall: 'yes',
    runtime: { mount: REFUSE, mountPane: REFUSE, mountPage: REFUSE, bindGlue: () => bound },
    data: {
      listing: async () => ({ ok: true, value: LISTED }),
      installs: async () => ({ ok: true, value: [INSTALL] }),
      setDisabledForMe: async (_id, disabled) => ({ ok: true, value: disabled }),
      setPeerConsentForMe: REFUSE,
    },
    reload: () => undefined, openLink: () => undefined, linkUrl: () => '', copyText: async () => undefined, ...zoneClaims(),
  };
}

function Tabs({ glue }) {
  const env = useMemo(() => environment(glue), [glue]);
  const model = useNodeTabs({ nodeId: 'n1', chatEnabled: false, nodeMetadata: { app_tabs: [CALENDAR] }, workspaceMetadata: { default_app_tabs: [] }, here: INSTALLS_UNKNOWN, writer: NO_WRITES });
  return (
    <AppZoneContext.Provider value={env}>
      <NodeTabs
        model={model} contentView={<div data-testid="node-tabs-page" className="p-[16px]">The page</div>} chatChannelId={null} nodeId="n1" roomName="Platform"
        currentUserId={VIEWER} currentUserName={VIEWER} currentUserCid={1n} rules={null} onAdd={null}
        appPanel={(appId) => <AppTabPane appId={appId} tabId={appId} />}
      />
    </AppZoneContext.Provider>
  );
}

function Page() {
  const engine = useCalendarEngine();
  const glue = useMemo(() => (engine === null ? null : seededGlue(engine)), [engine]);
  return (
    <MemoryRouter>
      <WorkspaceProvider state={STATE}>
        <PermissionsProvider>
          <TooltipProvider>
            <ConfirmDialogProvider>
              <header className="h-[3.5rem] border-b border-border" aria-label="The app's header" />
              <OfficeLayout title="Platform" nodeId="n1" isEditing={false} onEditToggle={() => {}} canEdit={false} editDeniedReason="Read only here">
                {glue === null ? <p>Loading the calendar</p> : <Tabs glue={glue} />}
              </OfficeLayout>
            </ConfirmDialogProvider>
          </TooltipProvider>
        </PermissionsProvider>
      </WorkspaceProvider>
    </MemoryRouter>
  );
}

/** The Calendar's topic not joined: the notice the page shows above it, with Try again, under the tab row. */
let seeded = false;
function waitingOnTheTopic() {
  // Once, before the notice subscribes: the store is the page's, as an instance's rejoin writes it.
  if (!seeded) {
    seeded = true;
    offerTopicRetry(INSTALL.id, () => undefined);
    showTopicJoin(INSTALL.id, 'cal', { kind: 'waiting', reason: 'owner-offline', owner: { username: 'a-member-whose-username-runs-long', cid: 5n }, wake: { kind: 'auto', deadlineMs: Date.UTC(2026, 10, 27, 15, 5) } });
  }
  return <Page />;
}

export const APP_OVERFLOW_SCENARIOS = {
  'app-tab-overflow': () => <Page />,
  'app-tab-topic-waiting': waitingOnTheTopic,
};
