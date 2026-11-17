/**
 * The username of a group message's sender -- the key every avatar and name lookup needs.
 *
 * The two group wires disagree about `sender_id`:
 *   - an office/room/node channel (workspace server) carries the account USERNAME;
 *   - a peer group carries the sender's CID (decimal), with the roster name in `sender_name`.
 * A decimal CID is never a username an avatar can be found under, so the roster name is used for
 * those. One function, so a third wire is one change and not a hunt.
 */
import type { GroupMessage } from '@/types/workspace-entities';

const DECIMAL_CID: RegExp = /^\d+$/;

export function senderUsernameOf(message: Pick<GroupMessage, 'sender_id' | 'sender_name'>): string {
  return DECIMAL_CID.test(message.sender_id) ? message.sender_name : message.sender_id;
}
