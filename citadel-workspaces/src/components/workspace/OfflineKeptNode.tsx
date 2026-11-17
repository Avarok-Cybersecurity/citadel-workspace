/**
 * A node shown from the tree this device kept, while the server link is down: always under
 * a notice that says so and when the tree is from, so it never passes for the live one. A
 * document opens in its app (its replica is this device's); anything else waits for the server.
 */
import type { DomainNode } from '@/components/layout/sidebar/tree-node-types';
import { nodeAppState, type NodeAppState } from '@/lib/citadel-apps/node-app-metadata';
import { offlineNotice } from '@/lib/offline-tree';
import { DocumentView } from '../documents/DocumentView';

export const OFFLINE_PAGE_WAITS: string = 'This page opens once the server is back.';

const atLocalTime = (ms: number): string => new Date(ms).toLocaleString();

export function OfflineKeptNode({ node, savedAt }: { node: DomainNode; savedAt: number }): JSX.Element {
  const app: NodeAppState = nodeAppState(node.metadata);
  return (
    <div className="flex h-full flex-col">
      <p role="status" data-testid="workspace-offline-notice" className="border-b border-border bg-muted px-4 py-2 text-sm text-muted-foreground">
        {offlineNotice(savedAt, atLocalTime)}
      </p>
      <div className="min-h-0 flex-1">
        {app.kind === 'none'
          ? <p data-testid="workspace-offline-waits" className="p-6 text-sm text-muted-foreground">{OFFLINE_PAGE_WAITS}</p>
          : <DocumentView key={node.id} node={node} app={app} />}
      </div>
    </div>
  );
}
