/**
 * Presence Manager
 *
 * Handles P2P presence status (online/offline/away) and typing indicators.
 */

import {
  MessagingLayerType,
  createTyping,
  createOnline,
  isPresenceUpdate,
  TYPING_POLL_INTERVAL_MS,
  TYPING_DISPLAY_DURATION_MS,
} from '@/types/messaging-layer';
import type { MessagingLayer } from '@/types/messaging-layer';
import type { PeerPresence } from './p2p-types';
import { debugLog } from '@/lib/debug-config';
import { notifyEach } from '@/lib/notify-listeners';
import { getPrivacySettings } from '@/lib/privacy-settings';

export type PresenceListener = (peerCid: bigint, presence: PeerPresence) => void;
export type TypingListener = (peerCid: bigint, isTyping: boolean) => void;

export interface PresenceManagerConfig {
  /** Function to send a P2P command */
  sendCommand: (peerCid: bigint, layer: MessagingLayer) => Promise<void>;
  /** Function to get all connected peer CIDs */
  getConnectedPeers: () => bigint[];
}

/**
 * The fastest a typing indicator is worth resending.
 *
 * Half the duration the peer displays it for: the indicator never lapses, and
 * the rate cannot follow the poll interval into something faster.
 *
 * At today's constants this guard never binds -- the poll is 1000ms and this
 * is 2000/2 -- so it changes nothing now and has no test, because a test
 * against these values cannot tell it from its own absence. It is here because
 * the rate WAS incidental: `lastSentTyping` was written and read nowhere, so a
 * poll made snappier for the local user would have multiplied traffic to the
 * peer, and every one of these shares the reliable ILM path and send window
 * with real messages.
 */
const MIN_TYPING_SEND_INTERVAL_MS: number = TYPING_DISPLAY_DURATION_MS / 2;

export class PresenceManager {
  private presenceListeners: PresenceListener[] = [];
  private typingListeners: TypingListener[] = [];

  // Typing polling state - managed per peer
  private typingPollingState: Map<bigint, {
    intervalId: NodeJS.Timeout | null;
    lastText: string;
    lastSentTyping: number;
  }> = new Map();

  // Our own presence status
  private ownPresence: PeerPresence = {
    status: MessagingLayerType.Online,
    lastUpdate: Date.now()
  };

  private readonly config: PresenceManagerConfig;

  constructor(config: PresenceManagerConfig) {
    this.config = config;
  }

  /**
   * Get own presence status
   */
  public getOwnPresence(): PeerPresence {
    return this.ownPresence;
  }

  /**
   * Send presence update to a specific peer
   */
  public async sendPresenceUpdate(recipientCid: bigint, presence: MessagingLayer): Promise<void> {
    // Gated here rather than in broadcastPresence so that BOTH the broadcast and
    // the single-peer path obey it — broadcastPresence loops through this one.
    if (!getPrivacySettings().showOnlineStatus) return;
    if (!isPresenceUpdate(presence)) {
      debugLog('PresenceManager', 'Invalid presence layer type');
      return;
    }

    await this.config.sendCommand(recipientCid, presence);
  }

  /**
   * Broadcast presence update to all connected peers
   */
  public async broadcastPresence(presence: MessagingLayer): Promise<void> {
    const connectedPeers: bigint[] = this.config.getConnectedPeers();

    for (const peerCid of connectedPeers) {
      await this.sendPresenceUpdate(peerCid, presence);
    }

    // Update own presence tracking
    if (presence.type === MessagingLayerType.CustomState) {
      this.ownPresence = {
        status: MessagingLayerType.CustomState,
        customText: presence.text,
        customColor: presence.indicator_icon_color,
        lastUpdate: Date.now()
      };
    } else if (
      presence.type === MessagingLayerType.Online ||
      presence.type === MessagingLayerType.Offline ||
      presence.type === MessagingLayerType.Away
    ) {
      this.ownPresence = {
        status: presence.type,
        lastUpdate: Date.now()
      };
    }
  }

  /**
   * Broadcast Online presence when P2P connection is established.
   */
  public async broadcastOnlineToNewPeer(peerCid: bigint): Promise<void> {
    try {
      await this.sendPresenceUpdate(peerCid, createOnline());
    } catch (error) {
      debugLog('PresenceManager', '[P2P] Failed to broadcast Online presence on connect:', error);
    }
  }

  /**
   * Notify presence listeners of a change
   */
  public notifyPresenceChange(peerCid: bigint, presence: PeerPresence): void {
    notifyEach(this.presenceListeners, 'presence', peerCid, presence);
  }

  /**
   * Notify typing listeners of a change
   */
  public notifyTypingChange(peerCid: bigint, isTyping: boolean): void {
    notifyEach(this.typingListeners, 'typing', peerCid, isTyping);
  }

  /**
   * Start typing polling for a peer conversation.
   * Call this when the user focuses on the input field.
   * The polling will check every TYPING_POLL_INTERVAL_MS if text changed.
   */
  public startTypingPolling(recipientCid: bigint, getCurrentText: () => string): void {
    // Stop any existing polling for this peer
    this.stopTypingPolling(recipientCid);

    const state: { intervalId: NodeJS.Timeout | null; lastText: string; lastSentTyping: number; } = {
      intervalId: null as NodeJS.Timeout | null,
      lastText: getCurrentText(),
      lastSentTyping: 0
    };

    state.intervalId = setInterval(() => {
      const currentText: string = getCurrentText();
      const textChanged: boolean = currentText !== state.lastText;
      state.lastText = currentText;

      // Changed, non-empty, and not more often than the peer needs.
      //
      // `lastSentTyping` was written here and read nowhere, so the send rate
      // was whatever `TYPING_POLL_INTERVAL_MS` happened to be -- one per
      // second, which is fine against a 2s display duration, and would become
      // five per second the day somebody polled at 200ms for a snappier
      // indicator. Every one of these goes down the same reliable ILM path as
      // real messages, behind the same send window.
      //
      // The rate now derives from the duration it exists to sustain: half of
      // it, so the indicator never lapses, and no faster whatever the poll
      // becomes.
      const sinceLastSend: number = Date.now() - state.lastSentTyping;
      if (textChanged && currentText.length > 0 && sinceLastSend >= MIN_TYPING_SEND_INTERVAL_MS) {
        void this.sendTypingIndicator(recipientCid);
        state.lastSentTyping = Date.now();
      }
    }, TYPING_POLL_INTERVAL_MS);

    this.typingPollingState.set(recipientCid, state);
  }

  /**
   * Stop typing polling for a peer conversation.
   * Call this when the user blurs the input field or sends a message.
   */
  public stopTypingPolling(recipientCid: bigint): void {
    const state: { intervalId: NodeJS.Timeout | null; lastText: string; lastSentTyping: number; } | undefined = this.typingPollingState.get(recipientCid);
    if (state?.intervalId) {
      clearInterval(state.intervalId);
    }
    this.typingPollingState.delete(recipientCid);
  }

  /**
   * Send a one-shot typing indicator to a peer.
   *
   * Public so callers that already manage their own typing state (e.g.
   * MessagingService.sendTypingIndicator, triggered by input focus/blur
   * effects in a message composer) can fire an indicator without
   * setting up the full polling machinery.
   */
  public async sendTypingIndicator(recipientCid: bigint): Promise<void> {
    // "Show typing indicators: off" now means the peer is not told. It used to
    // mean nothing at all: the setting was written to localStorage and read by
    // no one.
    if (!getPrivacySettings().showTypingIndicators) return;
    try {
      const layer: MessagingLayer = createTyping();
      await this.config.sendCommand(recipientCid, layer);
    } catch (error) {
      debugLog('PresenceManager', 'Failed to send typing indicator:', error);
    }
  }

  // Event listener registration
  public onPresenceChange(listener: PresenceListener): () => void {
    this.presenceListeners.push(listener);
    return () => {
      this.presenceListeners = this.presenceListeners.filter(l => l !== listener);
    };
  }

  public onTyping(listener: TypingListener): () => void {
    this.typingListeners.push(listener);
    return () => {
      this.typingListeners = this.typingListeners.filter(l => l !== listener);
    };
  }
}
