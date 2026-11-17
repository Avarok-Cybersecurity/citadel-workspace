/**
 * useGroupConversations Hook
 *
 * Orchestrator that composes state management, event handling, and
 * group action callbacks into a single hook interface.
 *
 * This is ad-hoc Citadel message groups — NOT the office/room chat that hangs
 * off a workspace node via chat_enabled. The two are separate mechanisms with
 * confusingly similar names, and the group-messaging integration specs cover the
 * other one.
 *
 * It was inert until recently, in three independent ways, all now closed:
 *
 * 1. Nothing fed the group list. useGroupState subscribes to group:created,
 *    group:invite-received, group:member-joined, group:member-left and
 *    group:deleted; nothing emitted any of them and GroupCreateSuccess was
 *    handled nowhere, so createGroup fired its request, the response was
 *    dropped, and the sidebar stayed empty. lib/group-conversations/
 *    group-response-service.ts now translates those responses into events.
 *
 * 2. group_key was sent as a string where the backend wants
 *    MessageGroupKey { cid: u64, mgid: u128 }, so GroupInvite / GroupLeave /
 *    GroupKick / GroupEnd could not deserialize. tsc could not see it because
 *    toInternalServiceRequest is a bare cast. groupIdToKey now encodes at every
 *    send site, and group-key.ts is the single place that knows the format.
 *
 * 3. invitePeer had no caller. The group settings panel now offers an invite
 *    control to members whose role permits it.
 */

import { useCallback } from 'react';
import type { UseGroupConversationsResult } from './use-group-conversations.types';
import { useGroupState, useSortedGroups } from './use-group-state';
import type { GroupConversation } from '@/types/group-entities';
import {
  sendGroupCreate,
  sendGroupInvite,
  sendGroupLeave,
  sendGroupListRequest,
} from '@/lib/group-conversations/group-requests';
import { rememberGroupName } from '@/lib/group-conversations/group-names';
import { awaitGroupCreated } from '@/lib/group-conversations/await-group-created';
import { updateGroups } from '@/lib/group-conversations/group-store';
import { kickGroupMember } from '@/lib/group-conversations/kick-group-member';
import { assignGroupRole } from '@/lib/group-conversations/assign-group-role';

// ============================================================================
// Hook Implementation
// ============================================================================

export function useGroupConversations(): UseGroupConversationsResult {
  const { groups, setGroups, hydrated, loading, setLoading, error, setError } = useGroupState();
  const sortedGroups: GroupConversation[] = useSortedGroups(groups);

  // Create a new group
  const createGroup: (name: string, initialMembers: Array<{ cid: string; username: string; roleId?: string; }>) => Promise<string> = useCallback(
    async (
      name: string,
      initialMembers: Array<{ cid: string; username: string; roleId?: string }>
    ): Promise<string> => {
      try {
        // `sendGroupCreate` resolves with its REQUEST id, not a group id. The
        // group's own id arrives with `group:created`, correlated on that
        // request id -- see awaitGroupCreated.
        const requestId: string = await sendGroupCreate(initialMembers);
        const groupId: string = await awaitGroupCreated(requestId);
        // The wire has no name field, so this is where the creator's choice
        // survives. Remembered BEFORE the store is nudged, because
        // `group:created` may already have arrived and built the record with
        // the username fallback.
        rememberGroupName(groupId, name);
        updateGroups(prev =>
          prev.map(g => (g.id === groupId && name.trim().length > 0 ? { ...g, name: name.trim() } : g)),
        );
        return groupId;
      } catch (e) {
        const errorMsg: string = e instanceof Error ? e.message : 'Failed to create group';
        setError(errorMsg);
        throw e;
      }
    },
    [setError]
  );

  // Invite a peer to a group
  const invitePeer: (groupId: string, peerCid: string) => Promise<void> = useCallback(
    async (groupId: string, peerCid: string): Promise<void> => {
      try {
        await sendGroupInvite(groupId, peerCid);
      } catch (e) {
        const errorMsg: string = e instanceof Error ? e.message : 'Failed to invite peer';
        setError(errorMsg);
        throw e;
      }
    },
    [setError]
  );

  // Leave a group
  const leaveGroup: (groupId: string) => Promise<void> = useCallback(async (groupId: string): Promise<void> => {
    try {
      await sendGroupLeave(groupId);
      setGroups(prev => prev.filter(g => g.id !== groupId));
    } catch (e) {
      const errorMsg: string = e instanceof Error ? e.message : 'Failed to leave group';
      setError(errorMsg);
      throw e;
    }
  }, [setError, setGroups]);

  // Kick a member from a group
  const kickMember: (groupId: string, memberCid: string) => Promise<void> = useCallback(
    async (groupId: string, memberCid: string): Promise<void> => {
      try {
        await kickGroupMember(groupId, BigInt(memberCid));
      } catch (e) {
        const errorMsg: string = e instanceof Error ? e.message : 'Failed to kick member';
        setError(errorMsg);
        throw e;
      }
    },
    [setError]
  );

  // The store and the other members; see assign-group-role.
  const updateMemberRole: (groupId: string, memberCid: string, roleId: string) => Promise<void> = useCallback(
    async (groupId: string, memberCid: string, roleId: string): Promise<void> => {
      assignGroupRole(groupId, BigInt(memberCid), roleId);
    },
    []
  );

  // Get a specific group by ID
  const getGroup: (groupId: string) => GroupConversation | undefined = useCallback(
    (groupId: string) => groups.find(g => g.id === groupId),
    [groups]
  );


  // Refresh groups from server
  const refresh: () => Promise<void> = useCallback(async (): Promise<void> => {
    try {
      setLoading(true);
      await sendGroupListRequest();
    } catch (e) {
      const errorMsg: string = e instanceof Error ? e.message : 'Failed to refresh groups';
      setError(errorMsg);
    } finally {
      setLoading(false);
    }
  }, [setError, setLoading]);

  return {
    groups: sortedGroups,
    hydrated,
    loading,
    error,
    createGroup,
    invitePeer,
    leaveGroup,
    kickMember,
    updateMemberRole,
    getGroup,
    refresh,
  };
}
