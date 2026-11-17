/**
 * The main screens, assembled from the real components with typed-in input. For the UX Oracle's captures
 * and for the geometry walker; nothing here replaces a component.
 */
import { MemoryRouter } from 'react-router-dom';
import { TooltipProvider } from '@/components/ui/tooltip';
import { SidebarProvider } from '@/components/ui/sidebar';
import { WorkspaceProvider } from '@/contexts/WorkspaceContext';
import { PermissionsProvider } from '@/contexts/PermissionsContext';
import { ConfirmDialogProvider } from '@/components/shared/confirm-dialog';
import { Toaster } from '@/components/ui/sonner';
import { GroupChatHeader } from '@/components/chat/GroupChatHeader';
import { SettingsModal } from '@/components/SettingsModal';
import { OfficeLayout } from '@/components/office/OfficeLayout';
import { WORKSPACE_ROOT_ID } from '@/lib/workspace-constants';
import Landing from '@/pages/Landing';
import { ADA } from './scenarios-people.jsx';

const NOTHING = () => {};
const STATE = {
  members: { ada: ADA, grace: { id: 'grace', username: 'grace', displayName: 'Grace Hopper', role: 'admin', isOnline: true } },
  currentUser: { id: 'me', username: 'me', name: 'Me' },
  nodes: {}, treeSchema: null, loading: { workspace: false, members: false, nodes: false },
};

export function Shell({ children, route = '/', state = STATE }) {
  return (
    <MemoryRouter initialEntries={[route]}>
      <WorkspaceProvider state={state}>
        <PermissionsProvider>
          <ConfirmDialogProvider>
            <TooltipProvider>
              <SidebarProvider>
                <Toaster />
                {children}
              </SidebarProvider>
            </TooltipProvider>
          </ConfirmDialogProvider>
        </PermissionsProvider>
      </WorkspaceProvider>
    </MemoryRouter>
  );
}

const treeNode = (id, parent, type, name) => ({
  id, parent_id: parent, entity_type: { Child: type }, depth: 0, name, description: '', owner_id: '', members: [], children: [],
  mdx_content: '', mdx_content_hash: null, rules: null, chat_enabled: false, chat_channel_id: null, default_permissions: {},
  metadata: [], allowed_child_types: [], is_default: false, created_at: 0n, updated_at: 0n,
});
/** Four levels deep, with names as long as people give them, so the header has to fold and truncate. */
const DEEP = {
  ...STATE,
  workspace: { id: 'w', name: 'LexelNet Research and Development' },
  nodes: Object.fromEntries([
    treeNode('hq', WORKSPACE_ROOT_ID, 'Office', 'Headquarters and Engineering Operations'),
    treeNode('floor', 'hq', 'Floor', 'Third floor, east wing'),
    treeNode('standup', 'floor', 'Room', 'Daily standup and planning for the platform team'),
  ].map((n) => [n.id, n])),
};

function OfficeHeader() {
  return (
    <Shell route="/workspace?nodeId=standup" state={DEEP}>
      <OfficeLayout title={DEEP.nodes.standup.name} nodeId="standup" isEditing={false} onEditToggle={NOTHING} canEdit>
        <p style={{ padding: 16 }}>The page under the header.</p>
      </OfficeLayout>
    </Shell>
  );
}

const settingsTab = (tab) => () => <Shell><SettingsModal open onOpenChange={NOTHING} tab={tab} /></Shell>;
const SignIn = () => <Shell><Landing /></Shell>;

export const SCREEN_SCENARIOS = { settings: settingsTab('general'), 'settings-connections': settingsTab('connections'), 'settings-appearance': settingsTab('appearance'), 'settings-privacy': settingsTab('privacy'), 'settings-notifications': settingsTab('notifications'), landing: SignIn, 'office-header': OfficeHeader };
