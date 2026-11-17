import { useEffect } from 'react';
import { isScreenshotKey } from '@/lib/p2p/screenshot-detection';
import { p2pMessengerManager } from '@/lib/p2p/p2p-messenger-manager';
import { createScreenshotNotice } from '@/types/screenshot-notice-layer';
import { debugLog } from '@/lib/debug-config';

/**
 * While a direct conversation is open, tell its peer when this page sees a
 * screenshot key. Best effort; see lib/p2p/screenshot-detection.ts.
 */
export type ScreenshotNoticeSender = (peerCid: bigint) => Promise<void>;

/** The production sender: the notice rides the ordinary P2P message path. */
export const sendScreenshotNotice: ScreenshotNoticeSender = (peerCid: bigint): Promise<void> =>
  p2pMessengerManager.sendRawMessage(peerCid, createScreenshotNotice(Date.now()));

export function useScreenshotNotice(peerCid: bigint | null, send: ScreenshotNoticeSender): void {
  useEffect(() => {
    if (peerCid === null) return;
    const onKeyUp = (event: KeyboardEvent): void => {
      if (!isScreenshotKey(event)) return;
      send(peerCid).catch((error: unknown) => debugLog('ScreenshotNotice', 'Could not send the notice:', error));
    };
    window.addEventListener('keyup', onKeyUp);
    return (): void => window.removeEventListener('keyup', onKeyUp);
  }, [peerCid, send]);
}
