/**
 * Marks a conversation read when the reader catches up with what the notch was
 * counting (View, or scrolling to the bottom), provided the window is in front
 * on the Messages tab. Passed to useStickToBottom as `onCaughtUp`.
 */
import { useCallback, type MutableRefObject } from 'react';
import { debugLog } from '@/lib/debug-config';
import type { HistoryPort } from '@/lib/chat/transport/chat-transport';
import { readableNow } from './useP2PMessages-read-gate';

export function useCatchUpRead(
  history: HistoryPort,
  activeTabIdRef: MutableRefObject<string>,
  pinnedRef: MutableRefObject<boolean>,
): () => void {
  return useCallback((): void => {
    if (!readableNow(activeTabIdRef, pinnedRef)) return;
    history.markRead(null).catch((err: unknown) => debugLog('UseP2PMessages', 'Error:', err));
  }, [history, activeTabIdRef, pinnedRef]);
}
