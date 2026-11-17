/**
 * A node pane's tabs: the list derived from the node and the workspace (lib/node-tabs/tab-list),
 * which one is open, who may change them, and the edits, each written to the server and shown
 * only once the server's answer (the node or workspace it broadcasts) has replaced the state the
 * list is derived from. Nothing is applied optimistically: a refused edit leaves the row as it was
 * and says why.
 */
import { useCallback, useMemo, useState } from 'react';
import { usePermission } from '@/hooks/use-permission';
import { permits } from '@/hooks/use-permission-result';
import { Permission } from '@/lib/permissions-service/types';
import { WORKSPACE_ROOT_ID } from '@/lib/workspace-constants';
import { toast } from '@/hooks/use-toast';
import type { MetadataSource } from '@/lib/workspace-metadata/metadata-document';
import { appIdsOf, deriveTabList, storedTabs, type NodeTabKey, type TabList } from '@/lib/node-tabs/tab-list';
import { APP_TABS_KEY, DEFAULT_APP_TABS_KEY } from '@/lib/node-tabs/tab-keys';
import { appendTab, moveTab, removeTab, type TabEdit } from '@/lib/node-tabs/tab-edits';
import { chooseOpenTab, deepLinkedTab, rememberTab, rememberedTab } from '@/lib/node-tabs/tab-memory';

/** Where tab edits are written: `WorkspaceService` in the app. */
export interface NodeTabsWriter {
  writeNodeTabs: (nodeId: string, appIds: readonly string[] | null) => Promise<void>;
  setDefaultAppTabs: (appIds: readonly string[]) => Promise<void>;
}

export type TabChange = { kind: 'left' | 'right' | 'remove' | 'add'; appId: string } | { kind: 'follow-default' } | { kind: 'use-everywhere' };

export interface NodeTabsModel {
  readonly list: TabList;
  readonly active: NodeTabKey;
  readonly select: (key: NodeTabKey) => void;
  /** May add, remove and reorder this node's app tabs (`UpdateNodeSettings`). */
  readonly canConfigure: boolean;
  /** May set the workspace's default tabs (`EditWorkspaceConfig`). */
  readonly canSetDefault: boolean;
  /** An edit is on its way to the server. */
  readonly busy: boolean;
  readonly change: (change: TabChange) => Promise<boolean>;
}

interface UseNodeTabsInput {
  nodeId: string;
  chatEnabled: boolean;
  nodeMetadata: MetadataSource;
  workspaceMetadata: MetadataSource;
  writer: NodeTabsWriter;
}

function editFor(change: TabChange, appIds: readonly string[]): TabEdit {
  switch (change.kind) {
    case 'left': return moveTab(appIds, change.appId, -1);
    case 'right': return moveTab(appIds, change.appId, 1);
    case 'remove': return removeTab(appIds, change.appId);
    case 'add': return appendTab(appIds, change.appId);
    case 'follow-default': case 'use-everywhere': return { ok: true, appIds };
  }
}

export function useNodeTabs({ nodeId, chatEnabled, nodeMetadata, workspaceMetadata, writer }: UseNodeTabsInput): NodeTabsModel {
  const list: TabList = useMemo((): TabList => deriveTabList({
    chatEnabled,
    node: storedTabs(nodeMetadata, APP_TABS_KEY),
    workspace: storedTabs(workspaceMetadata, DEFAULT_APP_TABS_KEY),
  }), [chatEnabled, nodeMetadata, workspaceMetadata]);

  // What the reader asked for; the open tab is the first of these still in the list, so a tab the
  // list has not loaded yet opens once it does, and a removed one falls back to the page.
  const [wanted, setWanted] = useState<string | null>((): string | null => deepLinkedTab(nodeId) ?? rememberedTab(nodeId));
  const active: NodeTabKey = chooseOpenTab(list.tabs, [wanted]);
  const select: (key: NodeTabKey) => void = useCallback((key: NodeTabKey): void => {
    setWanted(key);
    rememberTab(nodeId, key);
  }, [nodeId]);

  const configure: ReturnType<typeof usePermission> = usePermission(nodeId, Permission.UpdateNodeSettings);
  const setDefault: ReturnType<typeof usePermission> = usePermission(WORKSPACE_ROOT_ID, Permission.EditWorkspaceConfig);
  const [busy, setBusy] = useState<boolean>(false);

  const change: (requested: TabChange) => Promise<boolean> = useCallback(async (requested: TabChange): Promise<boolean> => {
    const current: string[] = appIdsOf(list);
    const edit: TabEdit = editFor(requested, current);
    if (!edit.ok) {
      toast({ title: 'The tabs were not changed', description: edit.why, variant: 'destructive' });
      return false;
    }
    setBusy(true);
    try {
      if (requested.kind === 'use-everywhere') await writer.setDefaultAppTabs(edit.appIds);
      else await writer.writeNodeTabs(nodeId, requested.kind === 'follow-default' ? null : edit.appIds);
      if (requested.kind === 'add') select(`app:${requested.appId}`);
      return true;
    } catch (error: unknown) {
      toast({ title: 'The tabs were not changed', description: error instanceof Error ? error.message : String(error), variant: 'destructive' });
      return false;
    } finally {
      setBusy(false);
    }
  }, [list, writer, nodeId, select]);

  return { list, active, select, canConfigure: permits(configure), canSetDefault: permits(setDefault), busy, change };
}
