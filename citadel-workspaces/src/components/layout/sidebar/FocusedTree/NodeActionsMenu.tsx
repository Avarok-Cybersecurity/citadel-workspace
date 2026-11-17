/**
 * A node's ⋯ menu: Edit, Admin Settings, Add Child, New document, Move…, Share…, Set as Default, Delete.
 *
 * Lifted verbatim out of the recursive TreeNodeItem when the sidebar became a
 * focused tree, so the items, their order and their testids are the ones every
 * spec already addresses. An item whose handler is absent is not offered; the
 * synthetic workspace root passes only Admin Settings and Add.
 */
import {
  Plus,
  MoreVertical,
  Settings,
  Star,
  FolderInput,
  Share2,
  FileText,
} from 'lucide-react';
import { documentPlacement, type DocumentPlacement } from '@/components/documents/document-placement';
import { getEntityTypeString } from '@/lib/entity-type-registry';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { DomainNode } from '../tree-node-types';
import { WORKSPACE_ROOT_ID } from '@/lib/workspace-constants';
import { useShareLauncher, type ShareLauncher } from '@/components/share/use-share-launcher';

export interface NodeActions {
  onNodeEdit?: (node: DomainNode) => void;
  onNodeDelete?: (node: DomainNode) => void;
  onNodeCreate?: (parentId: string) => void;
  onAdminSettings?: (node: DomainNode) => void;
  onSetDefault?: (node: DomainNode) => void;
  onMoveNode?: (node: DomainNode) => void;
  /** Open "New document" under this node. */
  onNewDocument?: (parentId: string) => void;
}

interface NodeActionsMenuProps extends NodeActions {
  node: DomainNode;
}

export function NodeActionsMenu({
  node,
  onNodeEdit,
  onNodeDelete,
  onNodeCreate,
  onAdminSettings,
  onSetDefault,
  onMoveNode,
  onNewDocument,
}: NodeActionsMenuProps): JSX.Element {
  const typeName: string = getEntityTypeString(node.entity_type);
  const placement: DocumentPlacement = documentPlacement(node.allowed_child_types ?? [], node.name);
  // Every real node can be shared; the synthetic root is the workspace itself.
  const share: ShareLauncher = useShareLauncher();
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="tap-target h-5 w-5 reveal-on-hover text-muted-foreground hover:text-foreground hover:bg-card"
            onClick={(e) => e.stopPropagation()}
            aria-label={`Actions for ${node.name}`}
            data-testid={`tree-node-menu-${node.id}`}
          >
            <MoreVertical className="h-4 w-4" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" sideOffset={8}>
          {onNodeEdit && (
            <DropdownMenuItem
              onClick={() => onNodeEdit(node)}
              data-testid={`edit-node-${node.id}`}
            >
              Edit {typeName}
            </DropdownMenuItem>
          )}
          {onAdminSettings && (
            <DropdownMenuItem
              onClick={() => onAdminSettings(node)}
              data-testid={`admin-settings-node-${node.id}`}
            >
              <Settings className="h-4 w-4 mr-2" />
              Admin Settings
            </DropdownMenuItem>
          )}
          {onNodeCreate && node.allowed_child_types && node.allowed_child_types.length > 0 && (
            <DropdownMenuItem
              onClick={() => onNodeCreate(node.id)}
              data-testid={`create-child-${node.id}`}
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Child
            </DropdownMenuItem>
          )}
          {onNewDocument && (
            <DropdownMenuItem
              disabled={placement.kind === 'blocked'}
              onClick={() => onNewDocument(node.id)}
              data-testid={`new-document-${node.id}`}
            >
              <FileText className="h-4 w-4 mr-2" aria-hidden="true" />
              {placement.kind === 'blocked' ? `New document: ${placement.reason}` : 'New document'}
            </DropdownMenuItem>
          )}
          {onMoveNode && (
            <DropdownMenuItem
              onClick={() => onMoveNode(node)}
              data-testid={`move-node-${node.id}`}
            >
              <FolderInput className="h-4 w-4 mr-2" />
              Move…
            </DropdownMenuItem>
          )}
          {node.id !== WORKSPACE_ROOT_ID && (
            <DropdownMenuItem
              onClick={() => share.open({ kind: 'node', nodeId: node.id, name: node.name })}
              data-testid={`share-node-${node.id}`}
            >
              <Share2 className="h-4 w-4 mr-2" />
              Share…
            </DropdownMenuItem>
          )}
          {onSetDefault && !node.is_default && (
            <DropdownMenuItem
              onClick={() => onSetDefault(node)}
              className="text-warning-emphasis hover:text-warning-emphasis"
              data-testid={`set-default-node-${node.id}`}
            >
              <Star className="h-4 w-4 mr-2" />
              Set as Default
            </DropdownMenuItem>
          )}
          {onNodeDelete && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => onNodeDelete(node)}
                className="text-destructive-emphasis hover:text-destructive-emphasis hover:bg-destructive/15"
                data-testid={`delete-node-${node.id}`}
              >
                Delete {typeName}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {share.dialog}
    </>
  );
}
