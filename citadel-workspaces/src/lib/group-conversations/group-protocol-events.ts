/**
 * The group notifications that answer this session's own sends, or report what the group itself
 * did: a send's delivery report or refusal, a refused end, the group passing to a new owner, and
 * a group resuming on this device. A translator like the rest of group-events: a message in,
 * events out, null when it is none of these.
 */
import type { GroupDelivery, GroupMessageRefusal, GroupStateSource } from '@avarok/citadel-protocol-types';
import { groupKeyToId, parseGroupKey } from './group-key';
import type { GroupEvent, PeerNameResolver } from './group-events';
import { toCid, variant } from './group-wire-variants';
import { readDelivery, readRefusal, readStateSource } from './group-protocol-reads';
import { refusalText } from './group-send-outcome';

const requestIdOf = (raw: Record<string, unknown>): string | undefined => typeof raw.request_id === 'string' ? raw.request_id : undefined;

function sendAnswerEvents(message: Record<string, unknown>): GroupEvent[] | null {
  const report: Record<string, unknown> | undefined = variant(message, 'GroupMessageResponse');
  if (report) {
    const delivery: GroupDelivery | null = readDelivery(report.delivery);
    const requestId: string | undefined = requestIdOf(report);
    if (delivery === null || requestId === undefined) return [];
    return [{ name: 'group:send-outcome', payload: { groupId: groupKeyToId(parseGroupKey(report.group_key)), requestId, outcome: { delivery } } }];
  }
  const refused: Record<string, unknown> | undefined = variant(message, 'GroupMessageRefusedNotification');
  if (refused) {
    const refusal: GroupMessageRefusal | null = readRefusal(refused.refusal);
    if (refusal === null) return [];
    const groupId: string = groupKeyToId(parseGroupKey(refused.group_key));
    const requestId: string | undefined = requestIdOf(refused);
    const failed: GroupEvent = { name: 'group:failed', payload: { operation: 'Message', message: refusalText(refusal), groupId } };
    return requestId === undefined ? [failed] : [{ name: 'group:send-outcome', payload: { groupId, requestId, outcome: { refusal } } }, failed];
  }
  return null;
}

export function groupProtocolEvents(message: Record<string, unknown>, peerName: PeerNameResolver): GroupEvent[] | null {
  const answered: GroupEvent[] | null = sendAnswerEvents(message);
  if (answered) return answered;

  const transferred: Record<string, unknown> | undefined = variant(message, 'GroupOwnershipTransferredNotification');
  if (transferred) {
    const owner: bigint | null = toCid(transferred.owner);
    const previous: bigint | null = toCid(transferred.previous);
    if (owner === null || previous === null) return [];
    return [{
      name: 'group:owner-changed',
      payload: { groupId: groupKeyToId(parseGroupKey(transferred.group_key)), ownerCid: owner, previousCid: previous, ownerName: peerName(owner) },
    }];
  }

  const restored: Record<string, unknown> | undefined = variant(message, 'GroupRestoredNotification');
  if (restored) {
    const source: GroupStateSource | null = readStateSource(restored.source);
    if (source === null) return [];
    return [{ name: 'group:restored', payload: { groupId: groupKeyToId(parseGroupKey(restored.group_key)), source } }];
  }

  // A refused end left the group in place; the owner is told rather than shown nothing.
  const ended: Record<string, unknown> | undefined = variant(message, 'GroupEndNotification');
  if (ended && ended.success === false) {
    return [{ name: 'group:failed', payload: { operation: 'End', message: '', requestId: requestIdOf(ended) } }];
  }
  return null;
}
