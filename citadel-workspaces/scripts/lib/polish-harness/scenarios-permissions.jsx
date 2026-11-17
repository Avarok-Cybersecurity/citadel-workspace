/** The permission editors, mounted with typed-in roles and grants. A scenario supplies input; it never replaces a component. */
import { Checkbox } from '@/components/ui/checkbox';
import { useEffect } from 'react';
import { WorkspaceProvider } from '@/contexts/WorkspaceContext';
import { MemberPermissionsDialog } from '@/components/permissions/MemberPermissionsDialog';
import { PermissionManagerModal } from '@/components/permissions/PermissionManagerModal';
import { eventEmitter } from '@/lib/event-emitter';
import { WORKSPACE_ROOT_ID } from '@/lib/workspace-constants';
import { ADA } from './scenarios-people.jsx';

const NOTHING = () => {};

/**
 * The shared primitive on its own, as the consent and recovery forms use it -- and sized down by a caller, as
 * the role matrix once did with h-4 (its tick then sat 2-3px low), so the primitive must centre at any size.
 */
function BareCheckbox() {
  return (
    <div style={{ padding: 16, display: 'flex', gap: 16 }}>
      <Checkbox checked aria-label="A ticked box" />
      <Checkbox checked aria-label="A ticked box sized down" className="h-4 w-4" />
    </div>
  );
}

const level = (id, parent, type, name) => ({
  id, parent_id: parent, entity_type: { Child: type }, depth: 0, name, description: '', owner_id: '', members: [], children: [],
  mdx_content: '', mdx_content_hash: null, rules: null, chat_enabled: true, chat_channel_id: null, default_permissions: {}, metadata: [],
  allowed_child_types: [], is_default: false, created_at: 0n, updated_at: 0n,
});
const TREE = {
  workspace: { id: WORKSPACE_ROOT_ID, name: 'Acme' },
  members: { ada: ADA }, currentUser: { id: 'me', username: 'me', name: 'Me' },
  nodes: { hq: level('hq', WORKSPACE_ROOT_ID, 'Office', 'Headquarters'), standup: level('standup', 'hq', 'Room', 'Daily standup') },
  treeSchema: null, loading: { workspace: false, members: false, nodes: false },
};
/** What the server answers for Ada at each level: something from the workspace, something from the office, something here. */
const ANSWERS = { [WORKSPACE_ROOT_ID]: ['ViewContent', 'ReadMessages'], hq: ['ViewContent', 'ReadMessages', 'SendMessages'], standup: ['ViewContent', 'ReadMessages', 'SendMessages', 'UploadFiles'] };

/** One member's editor, opened on a room, once every level has answered. Parent effects run after the dialog's, so it is listening. */
function MemberPermissions() {
  useEffect(() => {
    for (const [domainId, permissions] of Object.entries(ANSWERS)) eventEmitter.emit('user:permissions:loaded', { userId: 'ada', domainId, role: 'Member', permissions });
  }, []);
  return <WorkspaceProvider state={TREE}><MemberPermissionsDialog open onClose={NOTHING} member={ADA} domainId="standup" /></WorkspaceProvider>;
}

/**
 * A role table as the server answers it, typed in: the built-ins plus one created role. Highest
 * first, as the server orders it. Input only -- the editor reads it from the same event the
 * response handler emits.
 */
const OWNER_HOLDS = ['CreateNode', 'DeleteNode', 'UpdateNode', 'CreateWorkspace', 'UpdateWorkspace', 'DeleteWorkspace', 'EditContent',
  'AddUsers', 'RemoveUsers', 'EditMdx', 'EditNodeConfig', 'AddNode', 'UpdateNodeSettings', 'ViewContent', 'ViewMembers', 'ManageNodeMembers',
  'SendMessages', 'ReadMessages', 'UploadFiles', 'DownloadFiles', 'ManageDomains', 'EditWorkspaceConfig', 'BanUser', 'EditTreeStructure',
  'ManageNodeTypes', 'Themes', 'ViewTelemetry', 'ManageRoles'];
const ROLE_TABLE = { roles: [
  { id: 'owner', name: 'Owner', permissions: OWNER_HOLDS, position: 65535, color: null },
  { id: 'admin', name: 'Admin', permissions: ['All'], position: 300, color: '#EF4444' },
  { id: 'member', name: 'Member', permissions: ['ViewContent', 'ViewMembers', 'SendMessages', 'ReadMessages', 'DownloadFiles'], position: 200, color: null },
  { id: 'role-reviewers', name: 'Reviewers', permissions: ['ViewContent', 'EditMdx'], position: 150, color: '#10B981' },
  { id: 'guest', name: 'Guest', permissions: ['ViewContent', 'ViewMembers'], position: 100, color: null },
], default_role_id: 'member' };
/** The reader is an Admin: Owner and Admin read-only, every role below editable. */
const AS_ADMIN = { ...TREE, currentUser: { id: 'me', username: 'me', name: 'Me', roleId: 'admin' } };

/** The role editor in its own dialog, as "Role permissions" in the sidebar opens it, once the table has arrived. */
function RolePermissions() {
  useEffect(() => { eventEmitter.emit('workspace:roles', { answer: { Roles: ROLE_TABLE } }); }, []);
  return <WorkspaceProvider state={AS_ADMIN}><PermissionManagerModal isOpen onClose={NOTHING} /></WorkspaceProvider>;
}

export const PERMISSION_SCENARIOS = { 'bare-checkbox': BareCheckbox, 'member-permissions': MemberPermissions, 'role-permissions': RolePermissions };
