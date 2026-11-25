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

const CALENDAR = calendarManifest.id;
const GRANTED = ['storage.user', 'storage.node', 'storage.node.authored', 'nodes.read'];
const INSTALL = { id: 'cal', app_id: CALENDAR, version: calendarManifest.version, scope: 'Workspace', granted: GRANTED, state: 'Active' };
const LISTED = listedApps([{
  source: { WorkspaceRegistry: { entry_id: CALENDAR } },
  manifest_bytes: Array.from(new TextEncoder().encode(JSON.stringify(calendarManifest))),
  signature: '0'.repeat(6618),
}])[0];
const STATE = { members: {}, currentUser: { id: VIEWER, username: VIEWER, name: VIEWER }, nodes: TREE, workspace: { metadata: [] }, treeSchema: null, loading: { workspace: false, members: false, nodes: false } };
const REFUSE = () => { throw new Error('this scenario mounts the Calendar only'); };
const NO_WRITES = { writeNodeTabs: async () => undefined, setDefaultAppTabs: async () => undefined };

function environment(glue) {
  const bound = { ready: Promise.resolve({ kind: 'bound', instance: glue }), close: async () => undefined };
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

export const APP_OVERFLOW_SCENARIOS = {
  'app-tab-overflow': () => <Page />,
};
