/**
 * The body of a node's page: its tabs when it has more than the page to show, or anything for
 * this person to do about them, otherwise the page alone. The page's app zones and its app tabs
 * share one zone environment (AppZonePage), so they read the node's installs once.
 */
import type { ReactNode } from 'react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import WorkspaceService from '@/lib/workspace-service';
import { openAppsModal, type AppsModalRequest } from '@/lib/citadel-apps/apps-modal-store';
import { appIdsOf } from '@/lib/node-tabs/tab-list';
import type { DomainNode } from '@/components/layout/sidebar/tree-node-types';
import { AppZonePage } from '../app-zone/AppZonePage';
import { pageZoneRuntime } from '../app-zone/lazy-runtime';
import { AppTabPane } from '../app-zone/AppTabPane';
import type { ChatSurface } from '../chat-surface';
import { NodeTabs } from './NodeTabs';
import { useNodeTabs, type NodeTabsModel, type NodeTabsWriter } from './use-node-tabs';

const WRITER: NodeTabsWriter = {
  writeNodeTabs: (nodeId: string, appIds: readonly string[] | null): Promise<void> => WorkspaceService.writeNodeTabs(nodeId, appIds),
  setDefaultAppTabs: (appIds: readonly string[]): Promise<void> => WorkspaceService.setDefaultAppTabs(appIds),
};

interface NodePaneProps {
  nodeId: string;
  node: DomainNode | null;
  chat: ChatSurface | null;
  contentView: ReactNode;
  roomName: string;
  reader: { id: string; displayName: string };
  /** The reader's CID; undefined until the tab knows it. */
  readerCid: bigint | undefined;
}

/** What "+" opens: the apps that can be a tab here, each added through this pane's own write. */
export function addTabRequest(nodeId: string, model: NodeTabsModel): AppsModalRequest {
  return { kind: 'tab', target: { nodeId, tabs: appIdsOf(model.list), add: (appId: string): Promise<boolean> => model.change({ kind: 'add', appId }) } };
}

/** Whether the pane needs its tab row at all: more than the page, or something to do about it. */
export function showsTabRow(model: NodeTabsModel): boolean {
  return model.list.tabs.length > 1
    || model.canConfigure
    || model.list.refused !== null
    || (model.list.workspaceHasNoDefault && model.canSetDefault);
}

export function NodePane({ nodeId, node, chat, contentView, roomName, reader, readerCid }: NodePaneProps): JSX.Element {
  const { state } = useWorkspace();
  const channelId: string | null = chat?.enabled === true ? chat.channelId : null;
  const model: NodeTabsModel = useNodeTabs({
    nodeId,
    chatEnabled: channelId !== null,
    nodeMetadata: node?.metadata,
    workspaceMetadata: state.workspace?.metadata,
    writer: WRITER,
  });
  return (
    <AppZonePage nodeId={nodeId} runtime={pageZoneRuntime}>
      {showsTabRow(model) ? (
        <NodeTabs
          model={model}
          contentView={contentView}
          chatChannelId={channelId}
          nodeId={nodeId}
          roomName={roomName}
          currentUserId={reader.id}
          currentUserName={reader.displayName}
          currentUserCid={readerCid}
          rules={node?.rules ? node.rules : null}
          appPanel={(appId: string): ReactNode => <AppTabPane appId={appId} tabId={appId} />}
          onAdd={model.canConfigure ? (): void => openAppsModal(addTabRequest(nodeId, model)) : null}
        />
      ) : contentView}
    </AppZonePage>
  );
}
