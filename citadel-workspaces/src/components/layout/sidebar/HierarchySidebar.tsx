import { useState, useCallback, useMemo } from 'react';
import { describeFailure } from '@/lib/failure-message';
import { debugLog } from '@/lib/debug-config';
import { useLocation, useNavigate } from 'react-router-dom';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useToast } from '@/hooks/use-toast';
import { toastSuccess, toastError } from '@/lib/toast-helpers';
import WorkspaceService from '@/lib/workspace-service';
import { getWorkspacePath } from '@/lib/workspace-navigation';
import { useSelectNode, type SelectNode } from '@/hooks/use-select-node';
import { getEntityTypeString } from '@/lib/entity-type-registry';
import { MoveNodeDialog } from './MoveNodeDialog';
import { TreeNodesSection, type DomainNode } from './TreeNodesSection';
import { HierarchySidebarModals } from './HierarchySidebarModals';
import { WORKSPACE_ROOT_ID } from '@/lib/workspace-constants';
import { usePermission } from '@/hooks/use-permission';
import { Permission } from '@/contexts/PermissionsContext';
import { createBlockedReason } from './AddNodeButton';
import { childTypeChoice, type ChildTypeChoice } from './child-type-choice';
import { useNewDocument, type NewDocumentFlow } from './use-new-document';
import type { NavigateFunction } from 'react-router';

/**
 * Orchestrator component that wires TreeNodesSection to workspace state.
 * Replaces the hardcoded OfficesSection + RoomsSection with a schema-driven tree.
 */
export function HierarchySidebar(): JSX.Element {
  const location: ReturnType<typeof useLocation> = useLocation();
  const navigate: NavigateFunction = useNavigate();
  const { state } = useWorkspace();
  const { toast } = useToast();

  const params: URLSearchParams = useMemo((): URLSearchParams => new URLSearchParams(location.search), [location.search]);
  const selectedNodeId: string | null = params.get('nodeId');

  // Modal state
  const [createModal, setCreateModal] = useState<{ parentId: string; entityType: string } | null>(null);
  // Set while the schema allows several child types and the user has not chosen one.
  const [typePick, setTypePick] = useState<{ parentId: string; parentName: string; types: string[] } | null>(null);
  const [editNode, setEditNode] = useState<DomainNode | null>(null);
  const [moveNode, setMoveNode] = useState<DomainNode | null>(null);
  const [adminNode, setAdminNode] = useState<DomainNode | null>(null);
  // What the server checks for every CreateNode; see createBlockedReason.
  const treeEdit: ReturnType<typeof usePermission> = usePermission(WORKSPACE_ROOT_ID, Permission.EditTreeStructure);

  // Build flat node list from state
  const nodes: DomainNode[] = useMemo(() => Object.values(state.nodes), [state.nodes]);

  // The breadcrumbs open nodes the same way; see use-select-node.
  const handleNodeSelect: SelectNode = useSelectNode();
  // Reveal what was just made by selecting the parent it went into: the
  // focused tree unfolds exactly the selected node's children, so the new
  // node is on screen without opening it -- which nobody asked for.
  const revealUnder: (parentId: string) => void = useCallback((parentId: string): void => { void handleNodeSelect(parentId); }, [handleNodeSelect]);
  const newDocument: NewDocumentFlow = useNewDocument(revealUnder);

  const handleNodeEdit: (node: DomainNode) => void = useCallback((node: DomainNode): void => {
    setEditNode(node);
  }, []);

  const handleNodeDelete: (node: DomainNode) => Promise<void> = useCallback(async (node: DomainNode): Promise<void> => {
    try {
      await WorkspaceService.deleteNode(node.id, true);

      // If we're currently viewing the deleted node, navigate away
      if (selectedNodeId === node.id) {
        navigate(getWorkspacePath());
      }

      const typeName: string = getEntityTypeString(node.entity_type);
      toastSuccess(toast, `${typeName} Deleted`, `${node.name} has been deleted successfully`);
    } catch (error) {
      debugLog('HierarchySidebar', 'Error deleting node:', error);
      // Rethrow. TreeNodesSection's dialog closes only on success and renders
      // its own role="alert" with the reason — and that entire path was dead,
      // because this handler always resolved. Two layers of failure handling,
      // neither of which could fire. The toast stays for callers that do not
      // present their own error.
      toastError(
        toast,
        'Could not delete',
        error instanceof Error ? error.message : 'Failed to delete node. Please try again.'
      );
      throw error;
    }
  }, [selectedNodeId, navigate, toast]);

  const handleNodeCreate: (parentId: string | null) => void = useCallback((parentId: string | null): void => {
    if (parentId === null) {
      // Creating a root-level child under the synthetic workspace root.
      // Allowed types come from the tree schema.
      //
      // Distinguish two empty-allowedTypes cases that look identical
      // syntactically but have very different user-facing meanings:
      //
      //   1. `state.treeSchema === undefined` — schema fetch is still
      //      in flight (post-auth bootstrap hasn't finished, or the
      //      user clicked the create button before workspace load
      //      completed). The right message is "still loading", not
      //      "permission denied" — the latter is an actively
      //      misleading regression that previously made admins think
      //      their permissions were broken.
      //
      //   2. `state.treeSchema` is loaded but the Workspace rule has
      //      no `allowed_child_types`. That's the genuine
      //      "non-admin trying to create at workspace level" case
      //      and the permission toast is correct.
      if (!state.treeSchema) {
        toastError(toast, 'Loading', 'Workspace schema is still loading. Please try again in a moment.');
        return;
      }
      const workspaceRule: { parent_type: string; allowed_child_types: string[] } | undefined = state.treeSchema.rules?.find(
        r => r.parent_type === 'Workspace'
      );
      const rootChoice: ChildTypeChoice = childTypeChoice(workspaceRule?.allowed_child_types);
      if (rootChoice.kind === 'none') {
        // GetTreeSchema answers everyone alike, so this is nearly unreachable; the real refusal
        // arrives from the server after submit and is reported verbatim there.
        toastError(
          toast,
          'Cannot create here',
          'This workspace does not allow new items at the top level.',
        );
        return;
      }
      if (rootChoice.kind === 'pick') {
        setTypePick({ parentId: WORKSPACE_ROOT_ID, parentName: state.workspace?.name || 'Workspace', types: rootChoice.types });
        return;
      }
      setCreateModal({ parentId: WORKSPACE_ROOT_ID, entityType: rootChoice.type });
      return;
    }

    const parentNode: DomainNode = state.nodes[parentId];
    if (!parentNode) return;

    const choice: ChildTypeChoice = childTypeChoice(parentNode.allowed_child_types);
    if (choice.kind === 'none') {
      toastError(toast, 'Cannot Add Here', `No child types are allowed under "${parentNode.name}".`);
      return;
    }
    if (choice.kind === 'pick') {
      setTypePick({ parentId, parentName: parentNode.name, types: choice.types });
      return;
    }
    setCreateModal({ parentId, entityType: choice.type });
  }, [state.nodes, state.treeSchema, state.workspace?.name, toast]);

  const handleAdminSettings: (node: DomainNode) => void = useCallback((node: DomainNode): void => {
    setAdminNode(node);
  }, []);

  const handleSetDefault: (node: DomainNode) => Promise<void> = useCallback(async (node: DomainNode): Promise<void> => {
    try {
      await WorkspaceService.updateNode(node.id, { isDefault: true });
      const typeName: string = getEntityTypeString(node.entity_type);
      toastSuccess(toast, `Default ${typeName} Updated`, `${node.name} is now the default`);
    } catch (error) {
      debugLog('HierarchySidebar', 'Error setting default:', error);
      toastError(toast, 'Error', describeFailure(error, 'Failed to set as default. Please try again.'));
    }
  }, [toast]);

  const handleMove: (nodeId: string, newParentId: string | null) => Promise<void> = useCallback(async (nodeId: string, newParentId: string | null): Promise<void> => {
    try {
      await WorkspaceService.moveNode(nodeId, newParentId);
      toastSuccess(toast, 'Moved', 'The change has been saved.');
    } catch (error) {
      debugLog('HierarchySidebar', 'Error moving node:', error);
      toastError(
        toast,
        'Could not move it',
        error instanceof Error ? error.message : 'Please try again.',
      );
    } finally {
      setMoveNode(null);
    }
  }, [toast]);

  return (
    <>
      <TreeNodesSection
        // Until the workspace record arrives there is no name to give the parent.
        workspaceName={state.workspace?.name || 'Workspace'}
        createBlockedReason={createBlockedReason(Boolean(state.treeSchema), treeEdit)}
        nodes={nodes.length > 0 ? nodes : undefined}
        selectedNodeId={selectedNodeId ?? undefined}
        onNodeSelect={handleNodeSelect}
        onNodeEdit={handleNodeEdit}
        onNodeDelete={handleNodeDelete}
        onNodeCreate={handleNodeCreate}
        onNewDocument={newDocument.open}
        onAdminSettings={handleAdminSettings}
        onSetDefault={handleSetDefault}
        onMoveNode={setMoveNode}
        title="HIERARCHY"
        isLoading={state.loading.nodes}
        unavailable={state.nodesUnavailable}
      />

      <MoveNodeDialog
        node={moveNode}
        nodes={state.nodes}
        onMove={handleMove}
        onClose={() => setMoveNode(null)}
      />

      <HierarchySidebarModals
        createModal={createModal}
        editNode={editNode}
        adminNode={adminNode}
        typePick={typePick}
        onPickType={(entityType: string): void => {
          if (typePick) setCreateModal({ parentId: typePick.parentId, entityType });
          setTypePick(null);
        }}
        onCloseTypePick={() => setTypePick(null)}
        onCloseCreate={() => setCreateModal(null)}
        onCreated={revealUnder}
        newDocument={newDocument}
        onCloseEdit={() => setEditNode(null)}
        onCloseAdmin={() => setAdminNode(null)}
      />
    </>
  );
}
