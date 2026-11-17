/**
 * Channel Types
 *
 * Message types, channel interfaces, and constants for inter-instance communication.
 */

import type { ProxyResponseData } from './outbound-queue';
import type { ChannelEnvelope } from './channel-envelope';
import type { CALL_TAKEN } from '@/lib/call/call-taken-elsewhere';
import type { RINGING_ELSEWHERE } from '@/lib/call/ringing-hand-off';
import type { CALL_DEPARTED } from '@/lib/call/call-departure';

export const CHANNEL_NAME: "citadel-instance-channel" = 'citadel-instance-channel';

export type ChannelMessageType =
  | 'outbound-request'
  | 'outbound-ack'
  | 'inbound-forward'
  | 'inbound-ack'
  | 'leader-election'
  | 'leader-heartbeat'
  | 'instance-announce'
  | 'instance-goodbye'
  | 'session-release'
  | 'cid-update'
  | 'cid-report-request'
  // A leader claiming execution of one outbound request id, broadcast the
  // moment the work starts so a transient leader promoted mid-flap does not
  // execute the same id again. See executed-requests.ts.
  | 'request-executed'
  // The leader's socket to the agent went down or came back; see agent-socket-state.ts.
  | 'agent-socket'
  // A session was claimed on the leader's connection; see claim-relay.ts.
  | 'session-claimed'
  // Whether anything shows the agent's notices changed; see notices-heard-relay.ts.
  | 'notices-heard'
  // A follower's encoded media frame for the leader's socket; see media-frame-relay.ts.
  | 'media-frame-out'
  // Call coordination between tabs, put on the receiving tab's bus unchanged;
  // see call-taken-elsewhere.ts, ringing-hand-off.ts and call-departure.ts.
  | typeof CALL_TAKEN
  | typeof RINGING_ELSEWHERE
  | typeof CALL_DEPARTED;

export interface ChannelMessage {
  type: ChannelMessageType;
  targetInstanceId: string; // '*' for broadcast, 'leader' for current leader, or specific instanceId
  senderInstanceId: string;
  /**
   * Unique to the SENDING DOCUMENT, never persisted. `senderInstanceId` comes
   * from sessionStorage, which Duplicate Tab copies — so two documents can
   * share one instance id and this is the only field that separates them.
   * Optional so a message from an older build still parses.
   */
  senderDocumentNonce?: string;
  timestamp: number;
  requestId?: string;
  payload?: unknown;
  status?: 'processed' | 'error';
  error?: string;
  data?: ProxyResponseData; // Typed data for acknowledgments
  /** The sender's build and leadership (channel-envelope.ts); absent from a protocol-1 build. */
  v?: ChannelEnvelope;
}
