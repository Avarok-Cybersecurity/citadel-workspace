/**
 * The page's end of an app notification's click (lib/citadel-apps/app-notices.ts): the card asks
 * for the node its app is mounted on, and this opens it the one way a node is opened
 * (`useSelectNode`, which asks first when an edit is unsaved), closing the panel.
 */
import { useEffect } from 'react';
import { eventEmitter } from '@/lib/event-emitter';
import type { AppNoticeTarget } from '@/lib/citadel-apps/app-notices';
import { useSelectNode, type SelectNode } from '@/hooks/use-select-node';

export function useAppNoticeOpener(closePanel: () => void): void {
  const selectNode: SelectNode = useSelectNode();
  useEffect(() => eventEmitter.on<AppNoticeTarget>('apps:open-node', (target: AppNoticeTarget): void => {
    closePanel();
    void selectNode(target.nodeId);
  }), [selectNode, closePanel]);
}
