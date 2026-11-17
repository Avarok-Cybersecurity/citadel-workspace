/**
 * Invitations waiting for an answer.
 *
 * `GroupInviteNotification` used to be accepted the moment it arrived:
 * group-store handed it straight to applyGroupInvite, which added the group and
 * sent `GroupRespondRequest { response: true }`. The agent does NOT auto-accept
 * -- it forwards the SDK's `GroupBroadcast::Invitation` as a notification and
 * waits for exactly that request -- so the choice was the UI's to offer, and it
 * never offered it. Now an invitation is held here until the person answers.
 *
 * Persisted per account, like the group list: the server does not re-send an
 * invitation, so one held only in memory would be unanswerable after a reload.
 * The same read-before-write rule as group-persistence applies -- a list that
 * was never read must not be written over one that was.
 */
import { dbGet, dbPut } from '@/lib/storage-utils';
import { instanceManager } from '@/lib/multi-instance/instance-manager';
import { notifyEach } from '@/lib/notify-listeners';
import { debugLog } from '@/lib/debug-config';
import type { GroupInvitePayload } from '@/hooks/use-group-state-invite';

const STORE: 'keyValue' = 'keyValue';

let invites: GroupInvitePayload[] = [];
let readKey: string | null = null;
const listeners: Set<() => void> = new Set<() => void>();

function key(): string | null {
  const own: bigint | null = instanceManager.cid;
  return own ? `group-invites:${own.toString()}` : null;
}

export function getPendingInvites(): GroupInvitePayload[] {
  return invites;
}

export function subscribeToInvites(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

async function persist(): Promise<void> {
  const k: string | null = key();
  if (!k || k !== readKey) return;
  try {
    await dbPut(STORE, k, invites);
  } catch (error) {
    debugLog('GroupInvites', 'Could not persist pending invitations', error);
  }
}

function update(next: GroupInvitePayload[]): void {
  if (next === invites) return;
  invites = next;
  notifyEach(listeners, 'group-invites');
  void persist();
}

/** False when this group is already pending: a redelivered notification is one invitation. */
export function addPendingInvite(invite: GroupInvitePayload): boolean {
  if (invites.some((pending) => pending.groupId === invite.groupId)) return false;
  update([...invites, invite]);
  return true;
}

export function removePendingInvite(groupId: string): void {
  if (!invites.some((pending) => pending.groupId === groupId)) return;
  update(invites.filter((pending) => pending.groupId !== groupId));
}

/** Load this account's pending invitations, merged under any that arrived first. */
export async function restorePendingInvites(): Promise<void> {
  const k: string | null = key();
  if (!k) return;
  try {
    const stored: GroupInvitePayload[] | undefined = await dbGet<GroupInvitePayload[]>(STORE, k);
    readKey = k;
    const missing: GroupInvitePayload[] = (Array.isArray(stored) ? stored : [])
      .filter((s) => !invites.some((live) => live.groupId === s.groupId));
    if (missing.length > 0) {
      update([...invites, ...missing]);
    } else if (invites.length > 0) {
      void persist();
    }
  } catch (error) {
    debugLog('GroupInvites', 'Could not read pending invitations', error);
  }
}

/** Another account's invitations are not this one's to answer; see resetGroupsForSession. */
export function forgetPendingInvites(): void {
  invites = [];
  readKey = null;
  notifyEach(listeners, 'group-invites');
}
