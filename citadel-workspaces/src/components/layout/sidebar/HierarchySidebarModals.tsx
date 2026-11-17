/**
 * The create, edit and admin-settings modals HierarchySidebar opens.
 *
 * Split out of HierarchySidebar.tsx, which was over the 250-line cap. The
 * sidebar owns which node each modal is for; this only renders them.
 */
import { NodeManagementModal } from '@/components/node/NodeManagementModal';
import { AdminModal } from '@/components/admin';
import { getEntityTypeString } from '@/lib/entity-type-registry';
import { ChildTypePicker } from './ChildTypePicker';
import { NewDocumentDialog } from '@/components/documents/NewDocumentDialog';
import type { NewDocumentFlow } from './use-new-document';
import type { DomainNode } from './TreeNodesSection';

interface HierarchySidebarModalsProps {
  createModal: { parentId: string; entityType: string } | null;
  editNode: DomainNode | null;
  adminNode: DomainNode | null;
  typePick: { parentName: string; types: string[] } | null;
  onPickType: (entityType: string) => void;
  onCloseTypePick: () => void;
  onCloseCreate: () => void;
  /** A node was created under `parentId`. */
  onCreated: (parentId: string) => void;
  onCloseEdit: () => void;
  onCloseAdmin: () => void;
  newDocument: NewDocumentFlow;
}

export function HierarchySidebarModals({
  createModal,
  editNode,
  adminNode,
  typePick,
  onPickType,
  onCloseTypePick,
  onCloseCreate,
  onCreated,
  onCloseEdit,
  onCloseAdmin,
  newDocument,
}: HierarchySidebarModalsProps): JSX.Element {
  const adminEntityType: string = adminNode
    ? getEntityTypeString(adminNode.entity_type).toLowerCase()
    : 'workspace';

  return (
    <>
      {typePick && (
        <ChildTypePicker parentName={typePick.parentName} types={typePick.types} onPick={onPickType} onClose={onCloseTypePick} />
      )}

      {/* Create Node Modal */}
      {createModal && (
        <NodeManagementModal
          isOpen={true}
          onClose={onCloseCreate}
          mode="create"
          entityType={createModal.entityType}
          parentId={createModal.parentId}
          onCreated={onCreated}
          onNewDocument={(): void => { onCloseCreate(); newDocument.open(createModal.parentId); }}
        />
      )}

      {newDocument.target && (
        <NewDocumentDialog
          parentName={newDocument.target.parentName}
          placement={newDocument.target.placement}
          onCreate={newDocument.create}
          onClose={newDocument.close}
        />
      )}

      {/* Edit Node Modal */}
      {editNode && (
        <NodeManagementModal
          isOpen={true}
          onClose={onCloseEdit}
          mode="edit"
          entityType={getEntityTypeString(editNode.entity_type)}
          node={editNode}
        />
      )}

      {/* Admin Settings Modal */}
      {adminNode && (
        <AdminModal
          isOpen={true}
          onClose={onCloseAdmin}
          entityType={adminEntityType}
          entityId={adminNode.id}
        />
      )}
    </>
  );
}
