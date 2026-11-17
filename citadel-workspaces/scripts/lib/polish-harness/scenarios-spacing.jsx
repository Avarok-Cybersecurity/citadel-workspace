/** Rows with the longest text a person can plausibly give them, in the narrowest room they get. */
import { TooltipProvider } from '@/components/ui/tooltip';
import { WorkspaceProvider } from '@/contexts/WorkspaceContext';
import { AllMembersRow } from '@/components/layout/sidebar/AllMembersRow';
import { GroupFileShareCard } from '@/components/chat/GroupFileShareCard';
import { VFSInspectorSheet } from '@/components/file-manager/VFSInspector';
import { NO_ACTIONS } from './scenarios-file-manager.jsx';

const NOTHING = () => {};
const BLOCKS = { managePermissions: null, changeRole: null, remove: null };
const STATE = {
  members: {}, currentUser: { id: 'me', username: 'me', name: 'Me' },
  nodes: {}, treeSchema: null, loading: { workspace: false, members: false, nodes: false },
};
const LONG = 'a-very-long-person-name-that-does-not-break-anywhere-at-all';

function AllMembers() {
  const member = (username, extra) => ({ id: username, username, displayName: username, role: 'admin', ...extra });
  return (
    <WorkspaceProvider state={STATE}>
      <TooltipProvider>
        <div style={{ width: 320, padding: 8 }}>
          {[member('ada', { displayName: 'Ada Lovelace' }), member(LONG, { email: `${LONG}@example-company-with-a-long-name.example.org`, title: 'Principal Engineer, Platform Reliability' })].map((m) => (
            <AllMembersRow key={m.id} member={m} currentUsername="me" blocks={BLOCKS} nameOfLevel={(id) => id} onManagePermissions={NOTHING} onEditMember={NOTHING} onRemoveMember={NOTHING} onOpenChat={NOTHING} onOpenFiles={NOTHING} />
          ))}
        </div>
      </TooltipProvider>
    </WorkspaceProvider>
  );
}

function FileShare() {
  return (
    <div style={{ width: 280, padding: 8 }}>
      <GroupFileShareCard share={{ name: `${LONG}-quarterly-report-final-v3.pdf`, size: 4_200_000, mimeType: 'application/pdf' }} senderName={LONG} />
    </div>
  );
}

const NODE = {
  name: `${LONG}.json`, type: 'file', path: `/projects/${LONG}/${LONG}.json`, createdAt: 1, updatedAt: 2,
  fileMetadata: { fileSize: 2048, fileType: 'application/json' }, fileState: 'Received',
};

/** An item's details as a phone shows them: the inspector's sheet, with the longest name and path. */
function Properties() {
  return <VFSInspectorSheet node={NODE} actions={NO_ACTIONS} peerName={LONG} storageName={`Shared with ${LONG}`} from={LONG} modified="Oct 9, 2026" onClose={NOTHING} />;
}

export const SPACING_SCENARIOS = { 'all-members': AllMembers, 'file-share': FileShare, 'file-properties': Properties };
