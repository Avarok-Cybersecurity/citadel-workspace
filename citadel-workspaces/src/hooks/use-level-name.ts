/**
 * The name to show for a level of the hierarchy, by id: a node by its own name,
 * the workspace (which is not a node) by the workspace's. Wiring only; the rule
 * is `levelName` in lib/member-access.ts.
 */
import { useCallback, useMemo } from 'react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { levelName } from '@/lib/member-access';

export function useLevelName(): (levelId: string) => string {
  const { state } = useWorkspace();
  const nodeNames: Record<string, string> = useMemo(
    (): Record<string, string> => Object.fromEntries(Object.values(state.nodes).map((node) => [node.id, node.name])),
    [state.nodes],
  );
  // Same fallback the workspace view uses before the workspace record arrives.
  const workspaceName: string = state.workspace?.name || 'Your workspace';
  return useCallback((levelId: string): string => levelName(levelId, nodeNames, workspaceName), [nodeNames, workspaceName]);
}
