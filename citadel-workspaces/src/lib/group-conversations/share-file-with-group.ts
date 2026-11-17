/**
 * Sharing one file into a peer group: the policy, over injected I/O.
 *
 * Order matters, and each step's failure means something different:
 *   1. refuse a file no member could receive, before anyone is told of it;
 *   2. announce it to the group -- if THAT fails nothing has been sent, so the
 *      caller gets the error and nobody holds a phantom offer;
 *   3. offer it to each member (group-file-fanout), where one member's failure
 *      is that member's row, never the whole share's;
 *   4. put the sender's copy, ledger and all, in the thread. After the fan-out,
 *      so the transcript records the ledger complete in one write.
 */
import type { GroupMember } from '@/types/group';
import type { GroupFileInfo, GroupFileShare, MemberDelivery } from '@/types/group-file-share';
import { assertInlineSendable } from '@/lib/file-transfer/send-operations';
import { fanOutFile, type FanOutDeps } from './group-file-fanout';
import { sharedFileText } from './group-file-preview';
import type { PeerGroupDelivery } from './peer-group-delivery';

export interface ShareFileDeps extends FanOutDeps {
  /** Sends the announcement; resolves to the message id the members will see. */
  announce: (groupId: string, info: GroupFileInfo) => Promise<string>;
  /** Places the sender's own copy; the peer wire does not echo to its sender. */
  deliverOwn: (delivery: PeerGroupDelivery) => void;
  now: () => number;
}

export interface ShareFileResult {
  messageId: string;
  deliveries: MemberDelivery[];
}

export function fileInfo(file: File): GroupFileInfo {
  return { name: file.name, size: file.size, mimeType: file.type || 'application/octet-stream' };
}

export async function shareFileWithGroup(
  groupId: string,
  members: readonly GroupMember[],
  file: File,
  deps: ShareFileDeps,
): Promise<ShareFileResult> {
  if (file.size === 0) {
    throw new Error(`"${file.name}" is empty. Files with no contents cannot be sent.`);
  }
  assertInlineSendable(file);

  const info: GroupFileInfo = fileInfo(file);
  const timestamp: number = deps.now();
  const messageId: string = await deps.announce(groupId, info);
  const deliveries: MemberDelivery[] = await fanOutFile(members, file, deps);

  const fileShare: GroupFileShare = { ...info, senderCid: deps.selfCid, deliveries };
  deps.deliverOwn({
    groupId,
    messageId,
    senderId: deps.selfCid.toString(),
    senderName: 'You',
    content: sharedFileText(info),
    timestamp,
    fileShare,
  });
  return { messageId, deliveries };
}
