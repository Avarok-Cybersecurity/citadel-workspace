import { useState, useCallback, useEffect, useMemo, useRef, type RefObject } from "react";
import { Search, X } from "lucide-react";
import { motion } from "framer-motion";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  useSidebar,
} from "@/components/ui/sidebar";
import { useIsMobile } from "@/hooks/use-mobile";
import { AddNodeButton } from "./AddNodeButton";
import { NodeDeleteDialog } from "./NodeDeleteDialog";
import { workspaceRoot } from "./tree-node-utils";
import { searchResults, type SearchResult } from "./focused-search";
import { FocusedTree } from "./FocusedTree/FocusedTree";
import { SearchResults } from "./FocusedTree/SearchResults";
import { AnimatePresence, FADE_OUT, PresenceScope, TreeMotion } from "./FocusedTree/tree-motion";
import { AutoHeight } from "./FocusedTree/tree-boxes";
import { addChildLabel } from "./FocusedTree/level-labels";

// Re-export all types for backward compatibility
export type { NodeEntityType, DomainPermissions, DomainNode, TreeNode, TreeSchema, NestingRule, EntityTypeConfig } from "./tree-node-types";
import type { DomainNode } from "./tree-node-types";

export interface TreeNodesSectionProps {
  nodes?: DomainNode[];
  /** The workspace's name, for the root row when the server sends no root node. */
  workspaceName: string;
  selectedNodeId?: string;
  onNodeSelect: (nodeId: string) => void;
  onNodeEdit?: (node: DomainNode) => void;
  onNodeDelete?: (node: DomainNode) => Promise<void> | void;
  onNodeCreate?: (parentId: string | null) => void;
  /** Open "New document" under a node; the workspace root is WORKSPACE_ROOT_ID. */
  onNewDocument?: (parentId: string) => void;
  onAdminSettings?: (node: DomainNode) => void;
  onSetDefault?: (node: DomainNode) => void;
  onMoveNode?: (node: DomainNode) => void;
  title?: string;
  isLoading?: boolean;
  /**
   * The node list's deadline expired without an answer.
   *
   * "Your workspace is empty. Click the + button to create your first space"
   * is advice, and following it after a failed load creates a duplicate space
   * in a workspace whose contents merely did not arrive.
   */
  unavailable?: boolean;
  /**
   * Null when creating can succeed; otherwise why it cannot (the schema has not
   * arrived, or the server would refuse this person). A control whose only
   * outcome is an error is disabled and says why; see AddNodeButton.
   */
  createBlockedReason?: string | null;
}

const NO_NODES: DomainNode[] = [];

export function TreeNodesSection({
  nodes = NO_NODES,
  selectedNodeId,
  onNodeSelect,
  onNodeEdit,
  onNodeDelete,
  onNodeCreate,
  onNewDocument,
  onAdminSettings,
  onSetDefault,
  onMoveNode,
  title = "HIERARCHY",
  isLoading = false,
  unavailable = false,
  createBlockedReason = null,
  workspaceName,
}: TreeNodesSectionProps): JSX.Element {
  const { setOpenMobile } = useSidebar();
  const isMobile: boolean = useIsMobile();

  const nodeMap: Record<string, DomainNode> = useMemo(
    (): Record<string, DomainNode> => Object.fromEntries(nodes.map((n: DomainNode): [string, DomainNode] => [n.id, n])), [nodes]);
  const root: DomainNode | null = useMemo((): DomainNode | null => workspaceRoot(nodes, workspaceName), [nodes, workspaceName]);
  const selected: DomainNode | null = (selectedNodeId !== undefined ? nodeMap[selectedNodeId] : undefined) ?? root;

  const [searchOpen, setSearchOpen] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const results: SearchResult[] = useMemo(
    (): SearchResult[] => (root ? searchResults(nodeMap, root, searchQuery) : []), [nodeMap, root, searchQuery]);
  const searching: boolean = searchOpen && searchQuery.trim() !== '';
  const searchInput: RefObject<HTMLInputElement> = useRef<HTMLInputElement>(null);
  // Pressing the search icon is asking to type: the field takes the focus it was opened for.
  useEffect((): void => { if (searchOpen) searchInput.current?.focus(); }, [searchOpen]);

  const [nodeToDelete, setNodeToDelete] = useState<DomainNode | null>(null);

  const handleNodeSelect: (nodeId: string) => void = useCallback((nodeId: string): void => {
    onNodeSelect(nodeId);
    setOpenMobile(false);
  }, [onNodeSelect, setOpenMobile]);

  const selectResult: (nodeId: string) => void = useCallback((nodeId: string): void => {
    setSearchQuery('');
    handleNodeSelect(nodeId);
  }, [handleNodeSelect]);

  // The root row stands for the workspace, which is not a stored node; adding to it is adding at the top level.
  const createUnder: (parentId: string) => void = useCallback((parentId: string): void => {
    onNodeCreate?.(root && parentId === root.id && !nodeMap[root.id] ? null : parentId);
  }, [onNodeCreate, root, nodeMap]);

  const closeSearch = (): void => {
    setSearchOpen(false);
    setSearchQuery('');
  };

  if (!isLoading && (!root || !selected)) {
    return (
      <SidebarGroup data-testid="hierarchy-section" className="flex-shrink-0 min-h-[4rem] mb-4">
        <div className="flex items-center justify-between gap-2 px-3 mb-2">
          <SidebarGroupLabel className="text-primary-accent font-semibold m-0 px-0 min-w-0 shrink truncate" title={title}>
            {title}
          </SidebarGroupLabel>
          {onNodeCreate && <AddNodeButton onClick={() => onNodeCreate(null)} blockedReason={createBlockedReason} label="Add to this workspace" testId="add-root-node-button" />}
        </div>
        <SidebarGroupContent>
          <div className="px-3 py-2 text-sm text-muted-foreground">
            {unavailable ? (
              <span data-testid="tree-unavailable">
                Your spaces could not be loaded. Nothing has been deleted — reload, or open
                another workspace and come back, to try again.
              </span>
            ) : (
              <span data-testid="tree-empty">
                {createBlockedReason === null
                  ? 'Your workspace is empty. Click the + button to create your first space.'
                  : 'No spaces yet. An administrator adds the first one.'}
              </span>
            )}
          </div>
        </SidebarGroupContent>
      </SidebarGroup>
    );
  }

  const addLabel: string | null = selected ? addChildLabel(selected) : null;
  const addBlocked: string | null = createBlockedReason ?? (selected && addLabel === null ? `Nothing can be added inside ${selected.name}` : null);

  return (
    <>
      <SidebarGroup data-testid="hierarchy-section" className="flex-shrink-0 min-h-[4rem] mb-4">
        <div className="flex items-center justify-between gap-2 px-3 mb-2">
          <SidebarGroupLabel className="text-primary-accent font-semibold m-0 px-0 min-w-0 shrink truncate" title={title}>
            {title}
          </SidebarGroupLabel>
          <div className="flex shrink-0 items-center gap-1">
            {root && nodes.length > 0 && (
              <Button
                variant="ghost"
                size="icon"
                className="tap-target h-6 w-6 text-primary-accent hover:bg-primary-accent/15 hover:text-foreground"
                onClick={() => (searchOpen ? closeSearch() : setSearchOpen(true))}
                aria-label={searchOpen ? 'Close the filter' : 'Filter the hierarchy'}
                aria-expanded={searchOpen}
                data-testid="tree-search-toggle"
              >
                <Search className="h-4 w-4" aria-hidden="true" />
              </Button>
            )}
            {onNodeCreate && selected && (
              <AddNodeButton
                onClick={() => createUnder(selected.id)}
                blockedReason={addBlocked}
                label={`${addLabel ?? 'Add'} to ${selected.name}`}
                testId="add-node-button"
              />
            )}
          </div>
        </div>
        {searchOpen && (
          <div className="px-3 mb-2">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
              <Input
                ref={searchInput}
                placeholder="Filter..."
                aria-label="Filter the hierarchy"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Escape') closeSearch(); }}
                className="h-7 pl-7 pr-7 text-xs bg-surface border-surface text-foreground/80 placeholder:text-muted-foreground"
                data-testid="tree-search-input"
              />
              <button
                type="button"
                onClick={closeSearch}
                aria-label="Clear and close the filter"
                className="tap-target absolute right-0.5 top-1/2 flex -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          </div>
        )}
        <SidebarGroupContent>
          {isLoading || !root || !selected ? (
            <div className="px-3 py-2 text-sm text-muted-foreground">Loading...</div>
          ) : (
            <TreeMotion>
              <AutoHeight>
                <AnimatePresence initial={false} mode="popLayout">
                  <motion.div key={searching ? 'results' : 'tree'} initial={{ opacity: 0 }} animate={{ opacity: 1 }} {...FADE_OUT}>
                    <PresenceScope>
                      {searching ? (
                        <SearchResults results={results} isMobile={isMobile} onSelect={selectResult} />
                      ) : (
                        <FocusedTree
                          nodes={nodeMap}
                          root={root}
                          selectedId={selected.id}
                          isMobile={isMobile}
                          actions={{ onNodeEdit, onNodeDelete: onNodeDelete ? setNodeToDelete : undefined, onNodeCreate: createUnder, onNewDocument, onAdminSettings, onSetDefault, onMoveNode }}
                          // "Add Child" and the Add rows are the same request; not offered when it would be refused.
                          canAdd={Boolean(onNodeCreate) && createBlockedReason === null}
                          onSelect={handleNodeSelect}
                          onAdd={createUnder}
                        />
                      )}
                    </PresenceScope>
                  </motion.div>
                </AnimatePresence>
              </AutoHeight>
            </TreeMotion>
          )}
        </SidebarGroupContent>
      </SidebarGroup>

      {onNodeDelete && (
        <NodeDeleteDialog node={nodeToDelete} nodes={nodes} onDelete={onNodeDelete} onClose={() => setNodeToDelete(null)} />
      )}
    </>
  );
}

export default TreeNodesSection;
