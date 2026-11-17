/**
 * Writing a node's app tabs and the workspace's default tabs. Each resolves when the SERVER has
 * accepted the write and rejects with its reason, through the matcher that tells our answer
 * from another member's broadcast of the same node or workspace.
 */
import type { WorkspaceProtocolRequestTS } from '@/types/workspace-protocol';
import { storedTabs, type StoredTabs } from '@/lib/node-tabs/tab-list';
import { APP_TABS_KEY, DEFAULT_APP_TABS_KEY } from '@/lib/node-tabs/tab-keys';
import type { MetadataSource } from '@/lib/workspace-metadata/metadata-document';
import { awaitWriteResponse } from './await-write-response';
import type { ProtocolSender } from './workspace-operations';

const sameList = (stored: StoredTabs, appIds: readonly string[] | null): boolean =>
  appIds === null
    ? stored.kind === 'absent'
    : stored.kind === 'list' && stored.appIds.length === appIds.length && stored.appIds.every((id: string, i: number): boolean => id === appIds[i]);

const metadataOf = (payload: unknown): MetadataSource =>
  payload && typeof payload === 'object' ? ((payload as Record<string, unknown>).metadata as MetadataSource) : undefined;

/**
 * Set the node's own app tabs to `appIds`, in order, or with `null` remove its list so it
 * follows the workspace default again. Every other metadata key is kept by the server's merge.
 */
export async function writeNodeTabs(sender: ProtocolSender, nodeId: string, appIds: readonly string[] | null): Promise<void> {
  const patch: string = JSON.stringify({ [APP_TABS_KEY]: appIds });
  const requestPart: WorkspaceProtocolRequestTS = {
    UpdateNode: { node_id: nodeId, metadata: Array.from(new TextEncoder().encode(patch)) },
  };
  return awaitWriteResponse(
    'UpdateNode',
    () => sender.sendProtocolRequest(requestPart),
    (payload: unknown): boolean =>
      (payload as { id?: unknown } | null)?.id === nodeId && sameList(storedTabs(metadataOf(payload), APP_TABS_KEY), appIds),
  );
}

/** Set the tabs every node without a list of its own shows. */
export async function setDefaultAppTabs(sender: ProtocolSender, appIds: readonly string[]): Promise<void> {
  const requestPart: WorkspaceProtocolRequestTS = { SetDefaultAppTabs: { app_tabs: [...appIds] } };
  return awaitWriteResponse(
    'SetDefaultAppTabs',
    () => sender.sendProtocolRequest(requestPart),
    (payload: unknown): boolean => sameList(storedTabs(metadataOf(payload), DEFAULT_APP_TABS_KEY), appIds),
  );
}
