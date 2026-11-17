/**
 * Sharing a file into a peer group, wired to the real services.
 *
 * WHY "P2P ONLY" FOR EVERY MEMBER, not the RE-VFS push ("Send File"):
 *   - Only P2P mode tells the SENDER what each member did. Its accept/decline
 *     travels back as an in-band signal (async-transfers.handleTransferResponse);
 *     a staged RE-VFS decline is local to the recipient (transfer-lifecycle
 *     .declineTransfer), and the sender's record completes at staging. A
 *     per-member "declined" column would be unfillable.
 *   - Accept actually gates the bytes. The push writes an encrypted copy into
 *     every member's storage before anyone agrees, against each member's own
 *     RE-VFS quota -- a poor thing to do to a whole group at once.
 *   - Neither mode reaches an offline member (the push needs them online at
 *     send time too), so the push buys nothing for the group case.
 *
 * The agent has no group file primitive: `SendFile` names one `peer_cid`, and
 * `GroupMessage` carries only an opaque body. Hence one announcement plus N
 * ordinary transfers through the existing service, which is reused, not forked.
 */
import { fileTransferService } from '@/lib/file-transfer';
import { p2pRegistrationService } from '@/lib/p2p-registration-service';
import { instanceManager } from '@/lib/multi-instance/instance-manager';
import { eventEmitter } from '@/lib/event-emitter';
import type { GroupConversation } from '@/types/group';
import type { GroupFileInfo } from '@/types/group-file-share';
import { getGroups } from './group-store';
import { sendPeerGroupBody } from './group-requests';
import { encodeGroupFileShare } from './group-file-codec';
import { deliverPeerGroupMessage, type PeerGroupDelivery } from './peer-group-delivery';
import { shareFileWithGroup, type ShareFileResult } from './share-file-with-group';
import { registrationLookup, type RegistrationLookup } from './group-file-registration';

function announce(groupId: string, info: GroupFileInfo): Promise<string> {
  return sendPeerGroupBody(groupId, (senderCid: bigint, messageId: string): Uint8Array => encodeGroupFileShare({
    group_id: groupId,
    message_id: messageId,
    sender_cid: senderCid,
    timestamp: Date.now(),
    file_share: { name: info.name, size: info.size, mime_type: info.mimeType },
  }));
}

/** Thread and sidebar both, for the reason send-group-message gives. */
function deliverOwn(delivery: PeerGroupDelivery): void {
  deliverPeerGroupMessage(delivery);
  eventEmitter.emit('group:message-received', { ...delivery });
}

export async function sendGroupFile(groupId: string, file: File): Promise<ShareFileResult> {
  const self: bigint | null = instanceManager.cid;
  if (self === null) throw new Error('Not connected: sign in again to share a file.');
  const group: GroupConversation | undefined = getGroups().find((g: GroupConversation): boolean => g.id === groupId);
  if (!group) throw new Error('This group is not loaded yet; try again in a moment.');

  const isRegistered: RegistrationLookup = await registrationLookup(
    p2pRegistrationService.getPeers().registeredPeers.map((p: { cid: bigint }): bigint => p.cid),
    () => p2pRegistrationService.listRegisteredPeersWithRetry(),
  );
  return shareFileWithGroup(groupId, group.members, file, {
    selfCid: self,
    isRegistered,
    sendFile: (recipientCid: string, f: File): Promise<string> => fileTransferService.sendFile(recipientCid, f),
    announce,
    deliverOwn,
    now: Date.now,
  });
}
