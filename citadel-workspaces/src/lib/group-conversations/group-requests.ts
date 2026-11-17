/**
 * Wire-level dispatch of Citadel message-group requests.
 *
 * Owns the shape of each GroupCreate / GroupInvite / GroupLeave / GroupKick /
 * GroupListGroupsFor request and the connection/client lookup that sends it —
 * including the MessageGroupKey encoding via groupIdToKey (see group-key.ts).
 * Split from hooks/use-group-conversations.ts so the hook keeps React state
 * and error surfacing while the protocol encoding lives beside the other
 * group-conversation wire modules.
 */

import { websocketService } from '@/lib/websocket-service';
import { toInternalServiceRequest } from '@/hooks/use-group-conversations.types';
import { groupIdToKey } from './group-key';
import { encodeGroupMessage } from './group-message-codec';
import type { CurrentConnectionInfo } from '@/lib/connection/types';
import type { MessageGroupKey } from '@/lib/group-conversations/group-key';

async function requireCid(): Promise<bigint> {
  const connectionInfo: CurrentConnectionInfo | null = (await import('../connection')).connectionManager.getConnectionInfo();
  const cid: bigint | null = connectionInfo?.cid || null;
  if (!cid) {
    throw new Error('Not connected to server');
  }
  return BigInt(cid);
}

/**
 * Send a group request the way every other subsystem sends one.
 *
 * This used to be `websocketService.getClient()`, which returns null in every
 * FOLLOWER tab by design — there is one WebSocket per browser, the leader owns
 * the client, and followers proxy through it. So all six group operations threw
 * "WebSocket client not initialized" in any tab but one: creating a group,
 * inviting, leaving, kicking, refreshing the list, and — worst — answering an
 * invitation.
 *
 * The invite case corrupted state silently. `applyGroupInvite` adds the group
 * locally first and then calls `sendGroupRespond`; in a follower that threw into
 * a catch that only debugLogs, which is nothing in production. The user saw the
 * group and could be messaged over P2P while the server never recorded their
 * membership: the creator's roster stayed empty, group calls stayed disabled,
 * and the first outbound send failed on a membership error with no UI signal
 * anywhere. Group invitations are CID-routed to the tab owning that session, so
 * the tab that receives one is frequently not the leader.
 *
 * Nothing here needs the raw client. `sendMessage` awaits init, sends directly
 * on the leader and proxies on a follower.
 */
async function sendGroupRequest(request: Record<string, unknown>): Promise<void> {
  await websocketService.sendMessage(toInternalServiceRequest(request) as unknown as Record<string, unknown>);
}

/** Returns the request_id so the caller can correlate the eventual response. */
export async function sendGroupCreate(
  initialMembers: Array<{ cid: string; username: string; roleId?: string }>
): Promise<string> {
  const requestId: `${string}-${string}-${string}-${string}-${string}` = crypto.randomUUID();
  const cid: bigint = await requireCid();
  const request: { GroupCreate: { cid: bigint; request_id: `${string}-${string}-${string}-${string}-${string}`; initial_users_to_invite: { ID: bigint; }[]; }; } = {
    GroupCreate: {
      cid,
      request_id: requestId,
      // The wire type is Vec<UserIdentifier>, an externally-tagged enum — a
      // bare u64 fails to deserialize, the client rejects the request, and it
      // never leaves the browser. Invisible to tsc because
      // toInternalServiceRequest is a cast, and invisible to use because an
      // EMPTY list deserializes fine — only creating a group with members,
      // the one thing the dialog requires, could hit it.
      initial_users_to_invite: initialMembers.map(m => ({ ID: BigInt(m.cid) })),
    },
  };
  await sendGroupRequest(request);
  return requestId;
}

export async function sendGroupInvite(groupId: string, peerCid: string): Promise<void> {
  const cid: bigint = await requireCid();
  const request: { GroupInvite: { cid: bigint; peer_cid: bigint; group_key: MessageGroupKey; request_id: `${string}-${string}-${string}-${string}-${string}`; }; } = {
    GroupInvite: {
      cid,
      peer_cid: BigInt(peerCid),
      group_key: groupIdToKey(groupId),
      request_id: crypto.randomUUID(),
    },
  };
  await sendGroupRequest(request);
}

/**
 * Answer a group invitation at the backend.
 *
 * The UI's auto-accept used to be local-only: the invitee's sidebar gained the
 * group while the server still counted them merely invited, so the membership
 * broadcast that adds them to everyone else's roster never fired — and since a
 * group's callable roster IS its members, group calls stayed disabled for the
 * creator. `invitation: true` marks this as answering an invite we received
 * rather than a join request we reviewed.
 */
export async function sendGroupRespond(
  groupId: string,
  inviterCid: string,
  accept: boolean
): Promise<void> {
  const cid: bigint = await requireCid();
  const request: { GroupRespondRequest: { cid: bigint; peer_cid: bigint; group_key: MessageGroupKey; response: boolean; invitation: boolean; request_id: `${string}-${string}-${string}-${string}-${string}`; }; } = {
    GroupRespondRequest: {
      cid,
      peer_cid: BigInt(inviterCid),
      group_key: groupIdToKey(groupId),
      response: accept,
      invitation: true,
      request_id: crypto.randomUUID(),
    },
  };
  await sendGroupRequest(request);
}

export async function sendGroupLeave(groupId: string): Promise<void> {
  const cid: bigint = await requireCid();
  const request: { GroupLeave: { cid: bigint; group_key: MessageGroupKey; request_id: `${string}-${string}-${string}-${string}-${string}`; }; } = {
    GroupLeave: {
      cid,
      group_key: groupIdToKey(groupId),
      request_id: crypto.randomUUID(),
    },
  };
  await sendGroupRequest(request);
}

/** The caller mints `requestId`: the answer names no member, only this id. See kick-group-member.ts. */
export async function sendGroupKick(groupId: string, memberCid: bigint, requestId: string): Promise<void> {
  const cid: bigint = await requireCid();
  const request: { GroupKick: { cid: bigint; peer_cid: bigint; group_key: MessageGroupKey; request_id: string; }; } = {
    GroupKick: {
      cid,
      peer_cid: memberCid,
      group_key: groupIdToKey(groupId),
      request_id: requestId,
    },
  };
  await sendGroupRequest(request);
}

export async function sendGroupListRequest(): Promise<void> {
  const cid: bigint = await requireCid();
  const request: { GroupListGroupsFor: { cid: bigint; peer_cid: null; request_id: `${string}-${string}-${string}-${string}-${string}`; }; } = {
    GroupListGroupsFor: {
      cid,
      peer_cid: null,
      request_id: crypto.randomUUID(),
    },
  };
  await sendGroupRequest(request);
}

/** The groups this session is in, owned or joined; see learn-joined-groups.ts. */
export async function sendGroupListJoinedRequest(): Promise<void> {
  const cid: bigint = await requireCid();
  await sendGroupRequest({ GroupListJoined: { cid, request_id: crypto.randomUUID() } });
}

/**
 * End (delete) a group. Lived inline in GroupChatPage, which is why it was the
 * one group operation that never learned the follower-tab lesson the others
 * eventually did — it is here now, beside its five siblings.
 */
export async function sendGroupEnd(groupId: string): Promise<void> {
  const cid: bigint = await requireCid();
  const request: { GroupEnd: { cid: bigint; group_key: MessageGroupKey; request_id: `${string}-${string}-${string}-${string}-${string}`; }; } = {
    GroupEnd: {
      cid,
      group_key: groupIdToKey(groupId),
      request_id: crypto.randomUUID(),
    },
  };
  await sendGroupRequest(request);
}

/**
 * Send a message into a PEER group.
 *
 * Every other group operation had a wire call here and this one did not, so
 * `useGroupChat` sent through `WorkspaceService.sendGroupMessage` — the
 * workspace protocol — for both kinds of group. The workspace server authorises
 * that by resolving the group id to the node owning the chat channel, and a
 * peer group is keyed `<cid>:<mgid>` and owned by no node, so every send came
 * back "Permission denied: not a member of this chat channel". The server is
 * right to refuse: the channel is not its.
 *
 * `InternalServiceRequest::GroupMessage` has been on the wire the whole time.
 * Only this half was missing.
 *
 * Returns the message id it minted. The peer wire does NOT echo to the sender
 * — `requests/group/message.rs` answers with `GroupMessageSuccess`, which
 * carries no content — so the caller has to put the message on its own screen,
 * and needs this id to do it under the identity the peers will see.
 *
 * The body is CBOR, as every other P2P payload in this codebase is — see
 * types/p2p-commands.ts. `groupIdToKey` throws on an id that is not a group
 * key, which is deliberate: a node-backed channel id arriving here is a routing
 * mistake, and encoding it as a group key would put a malformed request on the
 * wire instead of failing where the mistake is.
 */
export async function sendPeerGroupMessage(
  groupId: string,
  content: string,
  replyTo?: string,
  /** The group's name, for the owner to tell members; see ownerAnnouncedName. */
  groupName?: string,
): Promise<string> {
  return sendPeerGroupBody(groupId, (cid: bigint, messageId: string): Uint8Array => encodeGroupMessage({
    group_id: groupId,
    message_id: messageId,
    sender_cid: cid,
    content,
    timestamp: Date.now(),
    reply_to: replyTo,
    group_name: groupName,
  }));
}

/** One `GroupMessage` send for any body the peers agree on -- chat or control. */
export async function sendPeerGroupBody(
  groupId: string,
  encode: (senderCid: bigint, messageId: string) => Uint8Array,
): Promise<string> {
  const cid: bigint = await requireCid();
  const groupKey: MessageGroupKey = groupIdToKey(groupId);
  // Minted here so a redelivery is the same message on the far side, and so the
  // sender's own copy carries the identity the peers will see.
  const messageId: string = crypto.randomUUID();
  const body: Uint8Array = encode(cid, messageId);

  const request: { GroupMessage: { cid: bigint; message: number[]; group_key: MessageGroupKey; request_id: `${string}-${string}-${string}-${string}-${string}`; }; } = {
    GroupMessage: {
      cid,
      message: Array.from(body),
      group_key: groupKey,
      request_id: crypto.randomUUID(),
    },
  };
  await sendGroupRequest(request);
  return messageId;
}
