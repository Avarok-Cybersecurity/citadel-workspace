/**
 * Message Handler
 *
 * Handles incoming P2P messages from WebSocket and routes them appropriately.
 * Type guards and routing logic are in sibling files.
 */

import type { P2PCommand, P2PMessagingLayerPayload } from '@/types/p2p-types';
import {
  P2PCommandType,
  deserializeP2PCommand,
  isMessagingLayerPayload,
  isMessageAckPayload,
} from '@/types/p2p-types';
import { BroadcastChannelService } from '../broadcast-channel-service';
import { ensureBigIntOrNull } from '../utils';
import type { InternalServiceResponse } from 'citadel-workspace-client-ts';
import { debugLog, debugEnabled } from '@/lib/debug-config';
import { dispatchInboundCommand, reportUnreadable } from './inbound-command-dispatch';
import { isCallSignalPayload } from '@/types/p2p-commands';
import { eventEmitter } from '../event-emitter';
import { consumeSendFailure } from './send-failure';
import { isHiddenAsStranger, productionStrangerGate } from './stranger-message-gate';
import { peerMessageBytes } from './peer-message-bytes';

import { isForThisSession } from '../sessions/notification-ownership';
import { isPeerMessage, isMessageNotification, type MessageNotificationPayload , type MessageHandlerConfig } from './message-handler-types';
import { handleMessagingLayerCommand } from './message-handler-routing';
import { MessageAckHandler } from './message-ack-handler';
import { EarlierEditorSync } from './earlier-editor-sync';
import { FileTransferMessageHandler } from './file-transfer-message-handler';

export type { MessageHandlerConfig } from './message-handler-types';
import { fnv1a64 } from './message-fingerprint';
import type { CallSignalPayload } from '@/types/call-signals';
import { CDOC_CHAT_COMMAND_EVENT, isCdocChatSyncPayload, type CdocChatCommandEvent } from '@/types/cdoc-chat-sync';

export class MessageHandler {
  private readonly config: MessageHandlerConfig;
  private readonly ackHandler: MessageAckHandler;
  private readonly fileTransferHandler: FileTransferMessageHandler;
  private readonly earlierEditorSync: EarlierEditorSync;

  constructor(config: MessageHandlerConfig) {
    this.config = config;
    this.earlierEditorSync = new EarlierEditorSync(config);
    this.ackHandler = new MessageAckHandler({
      getConversations: config.getConversations,
      updateMessageInPages: config.updateMessageInPages,
      notifyMessageStatusListeners: config.notifyMessageStatusListeners,
    });
    this.fileTransferHandler = new FileTransferMessageHandler({
      getOrCreateConversation: config.getOrCreateConversation,
      notifyMessageListeners: config.notifyMessageListeners,
      sendMessageAck: config.sendMessageAck,
      // The same store the text path uses. Handing it the store is the half of
      // this fix a unit test cannot see: the handler's own tests pass against a
      // stub whether or not the real construction site supplies one.
      addMessageToConversation: config.addMessageToConversation,
    });
  }

  /**
   * Handle WebSocket message response
   */
  public async handleWebSocketMessage(response: InternalServiceResponse): Promise<void> {
    // The agent's only signal that a message did NOT go out; see p2p/send-failure.ts.
    if (consumeSendFailure(response)) return;
    if (isMessageNotification(response)) {
      await this.handleMessageNotification(response);
      return;
    }

    if (isPeerMessage(response)) {
      const { peer_cid, message } = response.PeerMessage;
      try {
        const messageBytes: Uint8Array | null = peerMessageBytes(message);
        if (!messageBytes) {
          debugLog('P2PMessageHandler', 'Unexpected PeerMessage format:', typeof message);
          return;
        }
        const command: P2PCommand = deserializeP2PCommand(messageBytes);
        const peerCidBigint: bigint | null = ensureBigIntOrNull(peer_cid);
        if (peerCidBigint !== null) {
          await this.handleP2PCommand(command, peerCidBigint);
        }
      } catch (error) {
        debugLog('P2PMessageHandler', 'Failed to deserialize P2P command:', error);
      }
    }
  }

  /**
   * Handle MessageNotification response
   */
  private async handleMessageNotification(
    response: InternalServiceResponse & { MessageNotification: MessageNotificationPayload }
  ): Promise<void> {
    const notification: MessageNotificationPayload = response.MessageNotification;
    const { message: rawMessage, peer_cid, cid } = notification;

    const currentCid: bigint | null = await this.config.getCurrentCid();
    const peerCidBigint: bigint | undefined = ensureBigIntOrNull(peer_cid) ?? undefined;
    const notificationCidBigint: bigint | undefined = ensureBigIntOrNull(cid) ?? undefined;

    debugLog('MessageHandler', '[P2P] handleWebSocketMessage checking MessageNotification:', {
      peer_cid: peerCidBigint?.toString(),
      notification_cid: notificationCidBigint?.toString(),
      currentCid: currentCid?.toString(),
      isP2P: peerCidBigint !== undefined && peerCidBigint !== 0n,
    });

    if (peerCidBigint === undefined || peerCidBigint === 0n) {
      debugLog('MessageHandler', '[P2P] Skipping: no peer_cid or peer_cid is 0');
      return;
    }

    if (peerCidBigint === notificationCidBigint) {
      debugLog('MessageHandler', '[P2P] Skipping: peer_cid equals notification_cid (self-message)');
      return;
    }

    try {
      let contentBytes: Uint8Array;
      if (Array.isArray(rawMessage)) {
        contentBytes = new Uint8Array(rawMessage);
      } else if (rawMessage instanceof Uint8Array) {
        contentBytes = rawMessage;
      } else {
        debugLog('P2PMessageHandler', 'Unexpected message format (expected array or Uint8Array):', typeof rawMessage);
        return;
      }

      // fp joins this to ILM's `[ILM-DELIVER] ... fp=`. Guarded at the CALL
      // SITE: `debugLog` is a noop in production but its arguments are still
      // evaluated, so this hashed every byte of every inbound message and
      // handed the result to a function that discards it. `fnv1a64` is a
      // BigInt loop -- three BigInt operations per byte -- and the inline
      // transfer cap is 16 MiB, so a large file cost close to a second of
      // main-thread time here for no output at all.
      if (debugEnabled) {
        debugLog('MessageHandler', 'P2P message received:', contentBytes.length, 'bytes fp=' + fnv1a64(contentBytes));
      }

      // `p2p:raw-message` was emitted and re-broadcast to every tab here; nothing listened, so it is gone.

      // The notification's `cid` names the session it is addressed to, and this
      // tab is very often not that session: the leader holds the WebSocket even
      // when it is the landing/connect page, logged in as nobody. There used to
      // be a fallback here (`currentCid ?? notificationCid`) so that a tab with
      // no cid of its own would adopt the notification's — which made the guard
      // below vacuous and had a session-less tab store and emit another
      // account's messages as its own. `isForThisSession` refuses unless both
      // sides are known and equal; everything it refuses is broadcast to the
      // follower tabs, where the owner picks it up by matching its cid
      // (handleP2PNotification does that filtering). This also covers the old
      // own-outgoing-echo branch: an echo either matches this session's cid
      // (skipped above as a self-message) or belongs to another session's tab.
      if (!isForThisSession(notificationCidBigint, currentCid)) {
        debugLog('MessageHandler', '[P2P] Message not for this tab\'s session, broadcasting to follower tabs');
        BroadcastChannelService.getInstance().broadcastP2PNotification({ notification, messageBytes: contentBytes });
        return;
      }

      debugLog('MessageHandler', 'P2P MessageNotification received from peer:', peerCidBigint.toString());

      if (await isHiddenAsStranger(peerCidBigint, productionStrangerGate(this.config.isConnected))) {
        debugLog('P2PMessageHandler', `Not showing a message from ${peerCidBigint.toString()}: not a contact, and strangers are refused`);
        return;
      }
      await dispatchInboundCommand(contentBytes, (command) =>
        this.handleP2PCommand(command, peerCidBigint, notificationCidBigint), this.config, peerCidBigint
      );
    } catch (error) {
      await reportUnreadable(this.config, peerCidBigint, error);
    }
  }

  /**
   * Handle a P2P command
   */
  public async handleP2PCommand(command: P2PCommand, peerCid: bigint, recipientCid?: bigint): Promise<void> {
    debugLog('MessageHandler', '[P2P] handleP2PCommand received:', {
      type: command.type,
      typeValue: P2PCommandType[command.type] || command.type,
      peerCid: peerCid?.toString().slice(0, 12),
      hasPayload: !!command.payload,
    });

    switch (command.type) {
      case P2PCommandType.MessagingLayerCommand:
        if (isMessagingLayerPayload(command.payload)) {
          await handleMessagingLayerCommand(
            this.config,
            this.fileTransferHandler,
            command.payload as P2PMessagingLayerPayload,
            peerCid,
            recipientCid
          );
        } else {
          debugLog('P2PMessageHandler', 'handleP2PCommand: MessagingLayerCommand payload failed type check');
        }
        break;

      case P2PCommandType.MessageAck:
        debugLog('P2PMessageHandler', 'handleP2PCommand: MessageAck branch reached');
        if (isMessageAckPayload(command.payload)) {
          await this.ackHandler.handleMessageAck(command.payload, peerCid);
        } else {
          debugLog('P2PMessageHandler', 'handleP2PCommand: MessageAck payload failed type check', command.payload);
        }
        break;

      case P2PCommandType.YjsP2PSync:
        // A peer on an earlier version: its editor's sync has no reader here (earlier-editor-sync.ts).
        await this.earlierEditorSync.heard(peerCid);
        break;

      case P2PCommandType.CallSignal:
        // Emitted rather than handled inline, for the same reason as Yjs above:
        // the call provider is mounted once per tab and owns the call, and the
        // message handler has no business knowing about media sessions.
        if (isCallSignalPayload(command.payload)) {
          const signal: CallSignalPayload = command.payload;
          debugLog('P2PMessageHandler', 'handleP2PCommand: dispatching CallSignal', {
            kind: signal.kind,
            peerCid: peerCid.toString(),
          });
          eventEmitter.emit('call:signal', { peerCid, payload: signal });
        } else {
          debugLog('P2PMessageHandler', 'handleP2PCommand: CallSignal payload failed type check', command.payload);
        }
        break;

      case P2PCommandType.CdocChatSync:
        // Emitted, never handled here: the chat document's keeper (lib/cdoc/chat) is lazy, and this module never reaches cdoc.
        if (isCdocChatSyncPayload(command.payload)) eventEmitter.emit<CdocChatCommandEvent>(CDOC_CHAT_COMMAND_EVENT, { peerCid, recipientCid, payload: command.payload });
        else debugLog('P2PMessageHandler', 'handleP2PCommand: CdocChatSync payload failed type check');
        break;

      default:
        debugLog('P2PMessageHandler', 'handleP2PCommand: Unknown command type:', command.type);
    }
  }
}
