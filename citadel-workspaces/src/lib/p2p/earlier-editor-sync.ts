/**
 * The earlier chat editor's sync (YjsP2PSync), heard from a peer still on an earlier version.
 * Nothing in this version reads it: chat documents are Citadel Docs documents now, kept in step
 * by CdocChatSync, and the editor that applied these updates is gone. Dropped, never applied and
 * never a crash, but not silently: the conversation says once, per peer and page, that what
 * they change cannot reach this side until they update.
 */
import { debugLog } from '@/lib/debug-config';
import type { MessageHandlerConfig } from './message-handler-types';
import { noteFromPeer } from './inbound-unreadable-notice';

export function earlierEditorNoticeText(peerName: string): string {
  return `${peerName} is editing a chat document in an earlier version of the app. Their changes can't reach you until they update.`;
}

export class EarlierEditorSync {
  private readonly told: Set<bigint> = new Set<bigint>();

  constructor(private readonly config: MessageHandlerConfig) {}

  async heard(peerCid: bigint): Promise<void> {
    debugLog('P2PMessageHandler', 'Dropped the earlier chat editor\'s sync from', peerCid.toString());
    if (this.told.has(peerCid)) return;
    this.told.add(peerCid);
    try {
      await noteFromPeer(this.config, peerCid, earlierEditorNoticeText);
    } catch (error) {
      this.told.delete(peerCid);
      debugLog('P2PMessageHandler', 'Could not record that an earlier editor\'s sync was dropped:', error);
    }
  }
}
