/**
 * P2P Operations
 *
 * Handles peer-to-peer connection and messaging operations via the internal service.
 * Extracted from websocket-service.ts to reduce file size.
 */

import { requestResponse, requestResponseSoft } from './request-response';
import { debugLog, errorLog } from '../debug-config';
import { getDefaultSecuritySettings } from '../security-utils';
import { sendP2PMessage, sendP2PMessageBytes } from './p2p-message-dispatch';
import { disconnectP2P } from './p2p-disconnect';
import { TIMEOUT } from '../timeout-constants';
import type { SessionSecuritySettings } from '@/lib/security-utils';
import { withTurn, type TurnSource } from '../ice-servers/peer-connect-turn';
import type { TurnConfig } from '@/types/ice-servers';
import type { ChatSecurityLevel } from '@/lib/p2p/chat-advanced-settings';
import type { SendDelivery } from '@/lib/p2p/send-failure';

export interface P2PConfig {
  init: () => Promise<void>;
  sendMessage: (message: unknown) => Promise<void>;
  isLeader: () => boolean;
  /** Relay servers for the session that sends PeerConnect or PeerConnectAccept; null when none. */
  turnFor: TurnSource;
  /** The encryption level to open the channel between these two sessions at (the chat's setting). */
  securityFor: (cid: bigint, peerCid: bigint) => Promise<ChatSecurityLevel>;
}

interface PeerConnectBody {
  request_id: string;
  cid: bigint;
  peer_cid: bigint;
  udp_mode: string;
  session_security_settings: SessionSecuritySettings;
}

export class P2POperations {
  private readonly config: P2PConfig;

  constructor(config: P2PConfig) {
    this.config = config;
  }

  /** Send a P2P message to a peer. Delegates to the dispatch module. */
  async sendP2PMessage(cid: bigint, targetCid: bigint, message: string): Promise<void> {
    return sendP2PMessage(this.config, cid, targetCid, message);
  }

  /** Send raw bytes over the P2P channel. Delegates to the dispatch module. */
  async sendP2PMessageBytes(cid: bigint, targetCid: bigint, message: Uint8Array, delivery: SendDelivery): Promise<void> {
    return sendP2PMessageBytes(this.config, cid, targetCid, message, delivery);
  }

  /**
   * Open a P2P connection with a peer.
   */
  async openP2PConnection(cid: bigint, targetCid: bigint): Promise<void> {
    await this.config.init();

    if (cid === undefined || cid === null) {
      throw new Error('CID is required to open P2P connection');
    }

    if (cid === targetCid) {
      throw new Error('Cannot open P2P connection to self');
    }

    debugLog('P2POperations', 'Opening P2P connection', { cid: cid.toString(), targetCid: targetCid.toString() });

    const requestId: `${string}-${string}-${string}-${string}-${string}` = crypto.randomUUID();
    const base: PeerConnectBody = {
      request_id: requestId,
      cid: cid,
      peer_cid: targetCid,
      // Enabled so a call has a datagram path. Media cannot ride the reliable
      // channel: there is no such thing as a lost packet there, so congestion
      // becomes unbounded latency instead of loss, and a call three seconds
      // behind is worse than one that dropped a frame.
      //
      // Messaging is unaffected — it keeps using the reliable channel. If UDP
      // negotiation fails the connection still comes up; only calling is lost,
      // and the media layer reports that explicitly rather than hanging.
      udp_mode: 'Enabled',
      // The channel's ratchet is built at the level the OPENER asks for; the
      // acceptor's settings are ignored by the agent. So this is where a
      // chat's level is kept -- see chat-advanced-settings.
      session_security_settings: { ...getDefaultSecuritySettings(), security_level: await this.config.securityFor(cid, targetCid) },
    };
    // Fetched for `cid`, the session that initiates: its workspace server mints
    // the credentials, and its agent is the one that will use them.
    const turn: TurnConfig | null = await this.config.turnFor(cid);
    const peerConnectRequest: { PeerConnect: PeerConnectBody | (PeerConnectBody & { turn: TurnConfig }) } = {
      PeerConnect: withTurn(base, turn),
    };

    await requestResponse<true>({
      request: peerConnectRequest, requestId, timeoutMs: TIMEOUT.P2P_CONNECT_REQUEST_MS,
      sendRequest: this.config.sendMessage,
      operationName: 'PeerConnect',
      matcher: {
        matchSuccess: (msg) => {
          const r: { PeerConnectSuccess?: { request_id: string; }; } = msg as { PeerConnectSuccess?: { request_id: string } };
          if (r.PeerConnectSuccess?.request_id === requestId) {
            debugLog('P2POperations', 'P2P connection established', { targetCid: targetCid.toString() });
            return true;
          }
          return undefined;
        },
        matchFailure: (msg) => {
          const r: { PeerConnectFailure?: { request_id: string; message?: string; }; } = msg as { PeerConnectFailure?: { request_id: string; message?: string } };
          if (r.PeerConnectFailure?.request_id === requestId) {
            const error: string = r.PeerConnectFailure.message || 'PeerConnect failed';
            errorLog('P2P connection failed:', error);
            return error;
          }
          return undefined;
        },
      },
    });
  }

  /**
   * Accept an incoming P2P connection request.
   * This is sent in response to PeerConnectNotification to complete the handshake.
   * Resolves on both success AND failure (warn-and-continue pattern).
   */
  async acceptPeerConnect(cid: bigint, peerCid: bigint, notification: Record<string, unknown> | null): Promise<void> {
    return this.answerPeerConnect(cid, peerCid, notification, true);
  }

  /** Refuse it (a paused contact): ends their attempt instead of letting it time out. */
  async declinePeerConnect(cid: bigint, peerCid: bigint, notification: Record<string, unknown> | null): Promise<void> {
    return this.answerPeerConnect(cid, peerCid, notification, false);
  }

  private async answerPeerConnect(cid: bigint, peerCid: bigint, notification: Record<string, unknown> | null, accept: boolean): Promise<void> {
    await this.config.init();

    if (cid === undefined || cid === null || peerCid === undefined || peerCid === null) {
      throw new Error('CID and peerCid are required to answer a P2P connection');
    }

    debugLog('P2POperations', accept ? 'Accepting P2P connection' : 'Declining P2P connection', { cid: cid.toString(), peerCid: peerCid.toString() });

    const requestId: `${string}-${string}-${string}-${string}-${string}` = crypto.randomUUID();
    type AcceptBody = { request_id: string; cid: bigint; peer_cid: bigint; accept: boolean; udp_mode: string; session_security_settings: {}; peer_session_password: null; };
    // For `cid`, the ACCEPTING session's own server and agent; a refusal opens no path.
    const turn: TurnConfig | null = accept ? await this.config.turnFor(cid) : null;
    const acceptRequest: { PeerConnectAccept: AcceptBody | (AcceptBody & { turn: TurnConfig }) } = {
      PeerConnectAccept: withTurn<AcceptBody>({
        request_id: requestId,
        cid: cid,
        peer_cid: peerCid,
        accept,
        // Mirrors the initiator, defaulting to Enabled: a call needs BOTH ends
        // to have negotiated a datagram path, so an acceptor that quietly
        // dropped to Disabled would make every call it answered media-less.
        udp_mode: (notification?.udp_mode as string) || 'Enabled',
        session_security_settings: notification?.session_security_settings || getDefaultSecuritySettings(),
        peer_session_password: null
      }, turn),
    };

    await requestResponseSoft({
      request: acceptRequest, requestId, timeoutMs: TIMEOUT.P2P_ACCEPT_REQUEST_MS,
      sendRequest: this.config.sendMessage,
      operationName: 'PeerConnectAccept',
      matchSuccess: (msg) => {
        // `accept` is read, not just `request_id`. The response answers a
        // decline with the same type — it means "your answer was delivered",
        // not "they accepted" — so matching on the id alone would report a
        // refusal as a established connection. That exact confusion, on
        // PeerRegisterSuccess, is what registered peers people had declined.
        const r: { PeerConnectAcceptSuccess?: { request_id: string; accept?: boolean; }; } =
          msg as { PeerConnectAcceptSuccess?: { request_id: string; accept?: boolean } };
        const answer: { request_id: string; accept?: boolean } | undefined = r.PeerConnectAcceptSuccess;
        // A decline is settled by exactly the refusal, and never by an acceptance.
        if (answer?.request_id === requestId) {
          if ((answer.accept !== false) !== accept) {
            debugLog('P2POperations', `P2P answer came back ${answer.accept === false ? 'DECLINED' : 'accepted'}, not what was sent`, { peerCid });
            return false;
          }
          debugLog('P2POperations', accept ? 'P2P connection accept sent' : 'P2P connection decline sent', { peerCid });
          return true;
        }
        return false;
      },
      matchFailure: (msg) => {
        const r: { PeerConnectAcceptFailure?: { request_id: string; message?: string; }; } = msg as { PeerConnectAcceptFailure?: { request_id: string; message?: string } };
        if (r.PeerConnectAcceptFailure?.request_id === requestId) {
          return r.PeerConnectAcceptFailure.message || 'PeerConnectAccept failed';
        }
        return undefined;
      },
      onTimeout: () => debugLog('P2POperations', 'PeerConnectAccept timed out - continuing with PeerConnect fallback'),
      onFailure: (error) => debugLog('P2POperations', 'PeerConnectAccept failed:', error, '- will use PeerConnect fallback'),
    });
  }

  /** Disconnect from a specific P2P peer; the C2S connection stays up. See p2p-disconnect. */
  async disconnectP2P(localCid: bigint, peerCid: bigint): Promise<void> {
    return disconnectP2P(this.config, localCid, peerCid);
  }
}
