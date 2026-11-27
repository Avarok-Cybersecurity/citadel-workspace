/**
 * The page's end of an app notification's click (lib/citadel-apps/app-notices.ts): the card asks
 * for the node its app is mounted on, and this opens it the one way a node is opened
 * (`useSelectNode`, which asks first when an edit is unsaved), closing the panel. A native
 * notice's click arrives as the account link's `open=node:<id>` (lib/onboarding/link-target.ts)
 * and is opened the same way, once.
 */
import { useEffect } from 'react';
import { eventEmitter } from '@/lib/event-emitter';
import type { AppNoticeTarget } from '@/lib/citadel-apps/app-notices';
import { takeLinkTarget, type LinkTarget } from '@/lib/onboarding/link-target';
import { useSelectNode, type SelectNode } from '@/hooks/use-select-node';

export function useAppNoticeOpener(closePanel: () => void): void {
  const selectNode: SelectNode = useSelectNode();
  useEffect(() => {
    const open = (nodeId: string): void => {
      closePanel();
      void selectNode(nodeId);
    };
    const linked: Extract<LinkTarget, { kind: 'node' }> | null = takeLinkTarget(['node']);
    if (linked) open(linked.nodeId);
    return eventEmitter.on<AppNoticeTarget>('apps:open-node', (target: AppNoticeTarget): void => open(target.nodeId));
  }, [selectNode, closePanel]);
}
