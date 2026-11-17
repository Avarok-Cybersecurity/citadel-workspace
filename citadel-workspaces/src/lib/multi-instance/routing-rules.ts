/**
 * Routing Rules
 *
 * CID_ROUTED_NOTIFICATIONS, broadcast message types, CID field lists,
 * and routing configuration for the inbound router.
 */

import { INTERVAL } from '../timeout-constants';
import type { ResponseType } from 'citadel-workspace-client-ts';
import { SUPERVISOR_NOTIFICATION } from '@/types/agent-supervisor';
import { AGENT_RECONNECT_NOTIFICATIONS, type AgentReconnectNotification } from '@/types/agent-reconnect';

// Message types that should be broadcast to all instances.
//
// Everything on this list is EXEMPT from cid filtering, so membership must be
// deliberate fan-out and nothing else. 'ServerResponse' sat here for a long
// time matching no variant of `InternalServiceResponse` — dead, but lying in
// wait for a future variant of that name to bypass the filter by accident.
// The `satisfies` keeps the list honest: an entry that is not a real generated
// variant no longer compiles.
export const BROADCAST_MESSAGE_TYPES: string[] = [
  'DisconnectNotification', // Session disconnected
  'DeregisterSuccess', // Account deleted
  'UpdateAvailable', // A newer agent: the agent's, not a session's (cid 0), so every tab
] satisfies ResponseType[];

// Fields that commonly contain the target CID
export const CID_FIELDS: string[] = ['cid', 'peer_cid', 'session_cid'];

// Timeout for request tracking (5 minutes)
export const REQUEST_TRACKING_TIMEOUT_MS: number = INTERVAL.REQUEST_TRACKING_MS;

/**
 * Notification message types that should be routed by CID, NOT by request_id.
 * These messages have a request_id that belongs to the SENDER, but the message
 * should be delivered to the RECIPIENT (identified by the 'cid' field).
 */
export const CID_ROUTED_NOTIFICATIONS: Set<ResponseType | AgentReconnectNotification | typeof SUPERVISOR_NOTIFICATION> = new Set<ResponseType | AgentReconnectNotification | typeof SUPERVISOR_NOTIFICATION>([
  'PeerRegisterNotification',         // cid = recipient, request_id = sender's
  'PeerConnectNotification',          // cid = recipient, request_id = sender's
  'MessageNotification',              // cid = recipient, request_id = sender's (from SendMessage)
  'FileTransferRequestNotification',  // cid = recipient (file transfer initiation prompt)
  'FileTransferStatusNotification',   // cid = recipient (transfer progress/state)
  'FileTransferTickNotification',     // cid = recipient (transfer progress tick)
  // Media frames carry the SENDER's request_id, exactly like MessageNotification.
  // Routed by request_id they would be delivered to whichever tab happens to own
  // that request, so a second session in the same browser would receive another
  // session's call — audio and video both.
  'MediaFrameNotification',           // cid = recipient
  'MediaGapNotification',             // cid = recipient
  // A peer-group message, same shape as MessageNotification: `cid` is the
  // recipient and `request_id` belongs to whoever sent it. Routed by
  // request_id, a group message would be delivered to whichever tab issued
  // the sender's request -- so with two sessions in one browser, one session
  // would receive the other's group chat.
  'GroupMessageNotification',         // cid = recipient, request_id = sender's
  // cid = the session whose send failed. Its request_id belongs to a transport
  // frame, not to the request any tab issued, so request_id routing drops it --
  // which is how the UI came to ignore send failures entirely.
  'MessageSendFailure',
  // cid = the session whose peer connection changed path (relay -> direct, or
  // back). Unsolicited, request_id null: without cid routing it would reach no
  // tab, and the chat header would say "Relayed" for ever.
  'PeerPathChangedNotification',
  // cid = the session whose server link dropped, came back, or could not. They
  // answer no request, so without cid routing the leader tab would show another
  // tab's "Reconnecting…" and send the wrong account to sign-in. Not generated
  // variants yet; see types/agent-reconnect.ts.
  ...AGENT_RECONNECT_NOTIFICATIONS,
  // cid = the session whose links the supervisor is healing; unsolicited, so
  // without cid routing it would reach no tab (types/agent-supervisor.ts).
  SUPERVISOR_NOTIFICATION,
  // Multi-window (agent 0.8.6): addressed to the account, never to a request.
  // A ConversationEvent's request_id names the window's own send; routed by it,
  // the event would consume the pending entry the send's answer is waiting on.
  'ConversationEvent',
  'SessionRoleNotification',
  // cid = the session whose app host the P2P internal-HTTP frame is for; request_id is
  // the peer's send. Routed by request_id, with two sessions in one browser one
  // account's app would serve, or read the answers to, the other account's calls.
  'IhttpFrameNotification',
  // cid = the session whose app-topic message the server refused (too large, over the rate).
  // The agent always sends it with request_id null (kernel/responses/group_refusal.rs), so
  // routed by request_id it would reach no tab and the refusal would be lost.
  'GroupMessageRefusedNotification',
]);

/**
 * Answers a request receives on the way to its outcome, which must not spend
 * the route to the asking tab.
 *
 * `routeByRequestId` forgets a request once it is answered. These arrive under
 * the request's id BEFORE its terminal answer: a security-key challenge comes
 * mid-Connect or mid-SignInManagement, and RegisterSuccess comes ahead of the
 * connect_after_register answer. Spending the entry on them left the terminal
 * answer with no route -- a challenge's cid is 0 at sign-in -- so the tab that
 * asked waited out its timeout on a request that had succeeded.
 */
export const INTERIM_ANSWERS: Set<string> = new Set<string>([
  'SecurityKeyChallengeNotification',
  'RegisterSuccess',
] satisfies ResponseType[]);

/**
 * Forwards that must NOT be retained, acked, or replayed.
 *
 * The reliability machinery around a cross-tab forward costs, per message, a
 * `crypto.randomUUID()`, an armed `setTimeout`, the payload held in a Map until
 * the target tab acks, and a BroadcastChannel round trip. That is the right
 * price for a chat message, a file-transfer tick or a peer notification: each is
 * rare, and each matters.
 *
 * A media frame is neither. It arrives at frame rate, per track, per
 * participant, so the retention is a timer and a retained buffer for every
 * frame of every call. And the fallback is worse than the cost: when no ack
 * arrives in time the leader processes the message ITSELF, so one missed ack
 * decodes another tab's video on this one.
 *
 * A dropped frame is a dropped frame — exactly what a lost UDP packet is, which
 * the pipeline already handles: `MediaGapNotification` reports the hole and the
 * receiver asks for a keyframe. Replaying a two-second-old frame is not a
 * recovery, it is a worse artefact than the gap.
 *
 * `MediaGapNotification` is deliberately NOT here: it is low-rate, it is what
 * triggers that recovery, and losing it delays the keyframe.
 */
export const UNRELIABLE_FORWARDS: Set<string> = new Set<string>([
  'MediaFrameNotification',
]);

/**
 * Message types that the leader must ALSO process locally when forwarding to followers.
 * These messages affect P2P connection state which ILM needs to query.
 * ILM runs on the leader and calls getPeersForSession() for ANY CID, so the leader's
 * connectedPeers Map must have entries for ALL sessions (not just the leader's own).
 * TYPE-GAP: 'PeerDisconnect' exists at runtime but not in generated ResponseType
 */
export const LEADER_MUST_PROCESS_LOCALLY: Set<string> = new Set<ResponseType | string>([
  'PeerConnectNotification',  // Affects connectedPeers[targetCid]
  'PeerConnectSuccess',       // Affects connectedPeers[initiatorCid]
  'PeerDisconnect',           // Removes from connectedPeers
  'DisconnectNotification',   // Removes from connectedPeers (when peer C2S drops)
]);

/**
 * Get the type of the message (first key)
 */
/**
 * Whether a message type arrives at frame rate, so no per-message debug line may run for it.
 * The same types UNRELIABLE_FORWARDS names, for the same reason: 30-60 a second per track,
 * per participant. A debug line there redacts and prints the whole frame, payload and all,
 * six times per frame on the leader's path; in a three-way call that was ~420 console lines
 * a second per page, and the dev build CI runs pays all of it. Errors are not affected.
 */
export function arrivesAtFrameRate(messageType: string): boolean {
  return UNRELIABLE_FORWARDS.has(messageType);
}

export function getMessageType(message: unknown): ResponseType {
  if (!message || typeof message !== 'object') {
    return 'unknown' as ResponseType;
  }
  const keys: string[] = Object.keys(message);
  return (keys[0] || 'unknown') as ResponseType;
}

/**
 * Check if a message type should be broadcast to all instances
 */
export function shouldBroadcast(messageType: ResponseType): boolean {
  return BROADCAST_MESSAGE_TYPES.includes(messageType);
}
