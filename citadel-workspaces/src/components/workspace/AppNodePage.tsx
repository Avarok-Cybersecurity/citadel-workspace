/**
 * A node whose page is an installed app's (node-page-abi.md §3): the app fills the pane, with no
 * MDX chrome (no editor toolbar, no Edit button, no zone frame), under the node's breadcrumbs; the
 * node's chat and tabs stay where they always are (NodePane), with the app as its page.
 */
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useTabIdentity } from '@/hooks/use-tab-identity';
import { readerIdentity, type ReaderIdentity, type TabIdentity } from '@/lib/tab-identity';
import type { NodeAppPage } from '@/lib/citadel-apps/node-app-metadata';
import type { DomainNode } from '@/components/layout/sidebar/tree-node-types';
import { AppPagePane } from '../office/app-zone/AppPagePane';
import { useChatSurface, type ChatSurface } from '../office/chat-surface';
import { OfficeBreadcrumbs } from '../office/OfficeBreadcrumbs';
import { NodePane } from '../office/tabs/NodePane';

interface AppNodePageProps {
  node: DomainNode;
  /** The install the node's `citadel_app` envelope (v2) binds it to. */
  page: NodeAppPage;
}

export function AppNodePage({ node, page }: AppNodePageProps): JSX.Element {
  const { state } = useWorkspace();
  const tabSession: TabIdentity | null = useTabIdentity();
  const chat: ChatSurface | null = useChatSurface(node.id, node);
  const reader: ReaderIdentity = readerIdentity(state.currentUser, tabSession);
  return (
    <div className="flex h-[calc(100dvh-3.5rem)] flex-col overflow-hidden bg-background" data-testid="app-node-page" data-app-id={page.app}>
      <div className="flex min-h-[44px] items-center border-b border-border bg-card px-4 py-2">
        <OfficeBreadcrumbs nodeId={node.id} current={node.name} />
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        <NodePane
          nodeId={node.id}
          node={node}
          chat={chat}
          contentView={<AppPagePane page={page} />}
          roomName={node.name}
          reader={reader}
          readerCid={tabSession?.cid}
        />
      </div>
    </div>
  );
}
