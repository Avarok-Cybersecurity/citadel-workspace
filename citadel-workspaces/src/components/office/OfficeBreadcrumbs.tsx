/**
 * The header's breadcrumbs, wired: the live tree's path to `nodeId`, opened with the sidebar's select.
 */
import { useMemo } from 'react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useLevelName } from '@/hooks/use-level-name';
import { useSelectNode, type SelectNode } from '@/hooks/use-select-node';
import { domainPath, type DomainLevel } from '@/lib/domain-path';
import { WORKSPACE_ROOT_ID } from '@/lib/workspace-constants';
import { HierarchyBreadcrumbs } from './HierarchyBreadcrumbs';

interface OfficeBreadcrumbsProps {
  /** The node on screen; null is the workspace itself. */
  nodeId: string | null;
  current: string;
}

export function OfficeBreadcrumbs({ nodeId, current }: OfficeBreadcrumbsProps): JSX.Element {
  const { state } = useWorkspace();
  const workspaceName: string = useLevelName()(WORKSPACE_ROOT_ID);
  const path: DomainLevel[] = useMemo(
    (): DomainLevel[] => domainPath(state.nodes, nodeId ?? WORKSPACE_ROOT_ID, workspaceName),
    [state.nodes, nodeId, workspaceName],
  );
  const select: SelectNode = useSelectNode();
  return <HierarchyBreadcrumbs path={path} current={current} onSelect={(levelId: string): void => { void select(levelId); }} />;
}
