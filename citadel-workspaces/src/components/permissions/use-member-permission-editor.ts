/**
 * The state behind one member's permission editor: the path to the level it was
 * opened at, the server's answer at every level on it, and the edits. Save sends
 * the difference from the server's answer at the edited level — nothing else,
 * and nothing before every level has answered.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useLevelName } from '@/hooks/use-level-name';
import { WORKSPACE_ROOT_ID } from '@/lib/workspace-constants';
import { useLoadedPermissionsAt, type PermissionsLoad } from './use-loaded-permissions';
import { allLoaded, grantSource, type GrantSource, type PermissionLevel } from './member-permission-path';
import { domainPath } from '@/lib/domain-path';
import { applyPermissionChanges, permissionChanges, type PermissionChanges } from './permission-changes';
import { syncForNewReaders } from '@/components/documents/save/sync-for-new-readers';

export interface MemberPermissionEditor {
  /** The workspace first, down to the edited level. */
  path: PermissionLevel[];
  /** The level the edits apply to: the last on the path. */
  target: PermissionLevel;
  /** The server's answer at the edited level; its role is the member's role there. */
  targetLoad: PermissionsLoad;
  /** The first level that could not be read, if any. */
  failure: string | null;
  ready: boolean;
  isChecked: (permission: string) => boolean;
  sourceOf: (permission: string) => GrantSource | null;
  toggle: (permission: string) => void;
  changes: PermissionChanges;
  save: () => Promise<void>;
}

const LOADING: PermissionsLoad = { status: 'loading' };

export function useMemberPermissionEditor(userId: string, domainId: string): MemberPermissionEditor {
  const { state } = useWorkspace();
  // The workspace's own name, by the rule every other level name follows.
  const workspaceName: string = useLevelName()(WORKSPACE_ROOT_ID);
  const path: PermissionLevel[] = useMemo(
    (): PermissionLevel[] => domainPath(state.nodes, domainId, workspaceName),
    [state.nodes, domainId, workspaceName],
  );
  const target: PermissionLevel = path[path.length - 1];
  const levelIds: string[] = useMemo((): string[] => path.map((level: PermissionLevel): string => level.id), [path]);
  const loads: Readonly<Record<string, PermissionsLoad>> = useLoadedPermissionsAt(userId, levelIds);
  const targetLoad: PermissionsLoad = loads[target.id] ?? LOADING;
  const ready: boolean = allLoaded(path, loads);
  const failed: PermissionsLoad | undefined = levelIds.map((id: string) => loads[id]).find((load) => load?.status === 'failed');
  const failure: string | null = failed?.status === 'failed' ? failed.reason : null;

  const server: ReadonlySet<string> | null = targetLoad.status === 'loaded' ? targetLoad.permissions : null;
  const [edited, setEdited] = useState<Set<string> | null>(null);
  useEffect(() => { setEdited(server ? new Set(server) : null); }, [server]);

  const sourceOf: (permission: string) => GrantSource | null = useCallback((permission: string): GrantSource | null => grantSource(permission, path, loads), [path, loads]);
  const isChecked: (permission: string) => boolean = useCallback((permission: string): boolean => edited?.has(permission) ?? false, [edited]);
  const toggle: (permission: string) => void = useCallback((permission: string): void => {
    // A grant from a level above reaches this one whatever is set here, so
    // unticking it would change nothing the server enforces.
    if (sourceOf(permission)?.kind === 'inherited') return;
    setEdited((prev: Set<string> | null): Set<string> | null => {
      if (!prev) return prev;
      const next: Set<string> = new Set(prev);
      if (next.has(permission)) next.delete(permission); else next.add(permission);
      return next;
    });
  }, [sourceOf]);

  const changes: PermissionChanges = useMemo(
    (): PermissionChanges => (server && edited ? permissionChanges(server, edited) : { added: [], removed: [] }),
    [server, edited],
  );
  const save: () => Promise<void> = useCallback(async (): Promise<void> => {
    if (!ready) throw new Error('Not every level has answered yet; nothing was saved.');
    await applyPermissionChanges(userId, target.id, changes);
    if (changes.added.length > 0) syncForNewReaders(target.id, target.name);
  }, [ready, userId, target.id, target.name, changes]);

  return { path, target, targetLoad, failure, ready, isChecked, sourceOf, toggle, changes, save };
}
