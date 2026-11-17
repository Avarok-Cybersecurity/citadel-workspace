/**
 * Offering one file to every member of a peer group, one P2P transfer each.
 *
 * Pure policy over injected I/O, so partial failure and offline members can be
 * tested against the real decision rather than a mock of it. Every member other
 * than the sender comes back with an answer -- offered, skipped or failed, with
 * a reason -- because a member silently left out reads, on the sender's screen,
 * exactly like one who received the file.
 */
import type { GroupMember } from '@/types/group';
import type { MemberDelivery } from '@/types/group-file-share';
import { describeError } from '@/lib/describe-error';
import type { RegistrationLookup } from './group-file-registration';

export interface FanOutDeps {
  selfCid: bigint;
  /**
   * Whether this member is P2P-registered with the sender: true, false, or null
   * when that could not be established. See group-file-registration.
   */
  isRegistered: RegistrationLookup;
  /** The existing transfer service's send; resolves to the transfer id. */
  sendFile: (recipientCid: string, file: File) => Promise<string>;
}

export const NOT_REGISTERED_REASON: string = 'not P2P-registered with you';

/**
 * Why this member cannot be offered the file, or null when they can.
 *
 * Only a definite "not registered" skips. Presence and an open P2P channel are
 * NOT reasons: presence was "not known yet" for a peer who was online, and the
 * send path opens a channel to a registered peer on demand, so skipping on
 * either reported "not delivered" for someone the send would have reached.
 * An attempted send reports its own real outcome.
 */
export function skipReason(member: GroupMember, deps: Pick<FanOutDeps, 'isRegistered'>): string | null {
  return deps.isRegistered(member.cid) === false ? NOT_REGISTERED_REASON : null;
}

/**
 * Sequential on purpose. Each send reads the whole file into an inline payload
 * (see send-operations: boxed bytes, several times the file's size), so N sends
 * in parallel would hold N copies at once for no gain the user can see.
 */
export async function fanOutFile(members: readonly GroupMember[], file: File, deps: FanOutDeps): Promise<MemberDelivery[]> {
  const deliveries: MemberDelivery[] = [];
  const seen: Set<bigint> = new Set<bigint>([deps.selfCid]);
  for (const member of members) {
    if (seen.has(member.cid)) continue;
    seen.add(member.cid);
    const base: { cid: bigint; username: string } = { cid: member.cid, username: member.username };
    const reason: string | null = skipReason(member, deps);
    if (reason !== null) {
      deliveries.push({ kind: 'skipped', ...base, reason });
      continue;
    }
    try {
      const transferId: string = await deps.sendFile(member.cid.toString(), file);
      deliveries.push({ kind: 'offered', ...base, transferId });
    } catch (error) {
      deliveries.push({ kind: 'failed', ...base, reason: describeError(error) });
    }
  }
  return deliveries;
}
