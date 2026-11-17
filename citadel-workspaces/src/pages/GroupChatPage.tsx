/**
 * GroupChatPage Component
 *
 * Page for viewing and interacting with a custom peer group chat.
 *
 * The conversation is the shared chat pane over the peer group's transport
 * (PeerGroupChat); this page owns what is the group's and not the chat's: its
 * header, its call and its settings.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { callMembers, invitablePeers, type CallMember } from './group-roster';
import { useGroupSettingsActions } from './use-group-settings-actions';
import { useGroupPermissions } from '@/hooks/use-group-permissions';
import { useTabIdentity } from '@/hooks/use-tab-identity';
import { readerIdentity, selfCid, type ReaderIdentity, type TabIdentity } from '@/lib/tab-identity';
import { groupRestriction } from '@/components/chat/group-restriction';
import { useRegisteredPeers , type RegisteredPeer } from '@/hooks/use-registered-peers';
import { GroupChatHeader } from '@/components/chat/GroupChatHeader';
import { GroupCallControls } from '@/components/call/GroupCallControls';
import { GroupCallDock } from '@/components/call/GroupCallDock';
import { GroupSettingsPanel } from '@/components/chat/GroupSettingsPanel';
import type { GroupSettingsTab } from '@/components/chat/group-settings-types';
import { PeerGroupChat } from '@/components/chat/PeerGroupChat';
import { useGroupConversations } from '@/hooks/use-group-conversations';
import type { GroupConversation } from '@/types/group';
import { connectionManager } from '@/lib/connection';
import { AppLayout } from '@/components/layout/AppLayout';
import { debugLog } from '@/lib/debug-config';
import { groupGoneMessage, type GoneMessage } from '@/lib/group-conversations/group-gone-message';
import type { NavigateFunction } from 'react-router';
import type { CurrentConnectionInfo } from '@/lib/connection/types';

// ============================================================================
// Component
// ============================================================================

export function GroupChatPage(): JSX.Element {
  const { groupId } = useParams<{ groupId: string }>();
  const navigate: NavigateFunction = useNavigate();
  const { toast } = useToast();
  const {
    getGroup,
    hydrated,
    leaveGroup,
    kickMember,
    updateMemberRole,
    invitePeer,
  } = useGroupConversations();
  const { registeredPeers } = useRegisteredPeers();

  // State
  const [group, setGroup] = useState<GroupConversation | null>(null);
  // `group` is null until it loads, which is why the hook takes null. Both of
  // these permissions were computed and read by nobody until this call site.
  const { can, listedAsMember, myRole } = useGroupPermissions(group);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsTab, setSettingsTab] = useState<GroupSettingsTab>('members');

  // Get current user info.
  //
  // `currentUserId` is "my CID, if this tab knows it" and stays empty when it
  // does not: it decides who to leave OUT of a call invite, and guessing there
  // rings the caller in their own call. The chat no longer waits on it.
  const connectionInfo: CurrentConnectionInfo | null = connectionManager.getConnectionInfo();
  const currentUserId: string = connectionInfo?.cid ? String(connectionInfo.cid) : '';
  const tab: TabIdentity | null = useTabIdentity();
  const reader: ReaderIdentity = readerIdentity(
    connectionInfo ? { id: currentUserId, username: connectionInfo.username } : null,
    tab,
  );

  // Load group on mount
  useEffect(() => {
    if (!groupId) {
      navigate('/workspace');
      return;
    }

    // Nothing is knowable about a group until the restore has finished — see
    // `areGroupsHydrated`. Without this, every reload and shared link declared
    // the group deleted.
    if (!hydrated) return;

    const loadedGroup: GroupConversation | undefined = getGroup(groupId);
    if (!loadedGroup) {
      const gone: GoneMessage | null = groupGoneMessage(groupId);
      if (gone) toast({ ...gone, variant: 'destructive' });
      navigate('/workspace');
      return;
    }

    // Reading it is the chat pane's: its messages are read when the reader is caught up in front.
    setGroup(loadedGroup);
  }, [groupId, getGroup, hydrated, navigate, toast]);

  // Handlers
  const handleLeaveGroup: () => Promise<void> = useCallback(async (): Promise<void> => {
    if (!groupId) return;
    await leaveGroup(groupId);
    navigate('/workspace');
  }, [groupId, leaveGroup, navigate]);

  const handleKickMember: (memberCid: string) => Promise<void> = useCallback(
    async (memberCid: string) => {
      if (!groupId) return;
      // Every way a kick fails has already been shown by kickGroupMember, on the
      // group-failure toast; the roster moves only on the server's success.
      await kickMember(groupId, memberCid).catch((e: unknown): void => debugLog('GroupChatPage', 'kick failed', e));
    },
    [groupId, kickMember]
  );

  const handleRoleChange: (memberCid: string, roleId: string) => Promise<void> = useCallback(
    async (memberCid: string, roleId: string) => {
      if (!groupId) return;
      await updateMemberRole(groupId, memberCid, roleId);
    },
    [groupId, updateMemberRole]
  );

  const members: CallMember[] = useMemo(
    (): CallMember[] => callMembers(group, currentUserId),
    [group, currentUserId],
  );
  const invitable: RegisteredPeer[] = useMemo(
    (): RegisteredPeer[] => invitablePeers(group, registeredPeers),
    [group, registeredPeers],
  );

  const handleInviteMember: (peerCid: string) => Promise<void> = useCallback(
    async (peerCid: string) => {
      if (!groupId) return;
      try {
        await invitePeer(groupId, peerCid);
        toast({ title: 'Invitation sent' });
      } catch (error) {
        toast({
          title: 'Failed to invite',
          description: error instanceof Error ? error.message : 'Unknown error',
          variant: 'destructive',
        });
      }
    },
    [groupId, invitePeer, toast],
  );

  const { onSettingsChange, onNameChange, onDeleteGroup } = useGroupSettingsActions({
    groupId, setGroup, navigate, toast,
  });

  if (!group) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-full bg-background">
          <Loader2 className="h-8 w-8 animate-spin text-primary-accent" />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="flex flex-col h-full bg-background">
      {/* The route had no h1 at all, so heading navigation opened at level 2
          with no page title. Messages.tsx solved exactly this and the group
          route was missed. */}
      <h1 className="sr-only">Group chat</h1>

      {/* Header */}
      <GroupChatHeader
        group={group}
        onOpenSettings={(tab: GroupSettingsTab): void => { setSettingsTab(tab); setShowSettings(true); }}
        onLeaveGroup={handleLeaveGroup}
        // Calling needs to know who NOT to ring, so it waits for the CID that
        // the chat below no longer waits for.
        callControls={
          currentUserId ? (
            <GroupCallControls home={{ kind: 'group', roomId: group.id }} roomName={group.name} members={members} notConnected={[]} />
          ) : null
        }
      />

      {/* Docked above the messages, scoped to this group's call and no other. */}
      <GroupCallDock roomId={group.id} />

      {/* Real group chat with backend messaging. The wrapper gives the
          h-full chat view a bounded flex slot, so a docked call stage
          shrinks the messages instead of pushing the composer off-screen. */}
      {/* On `groupId` alone. This used to require `currentUserId`, which comes
          from `connectionManager.getConnectionInfo()` -- the CONNECTION's
          identity, not the tab's -- so a tab that could not resolve it rendered
          the group with no message list and no composer at all, which an
          integration run reports as "Message input not found". The chat needs
          the CID only to tell the reader's own messages, never to render. */}
      {groupId && (
        <div className="flex-1 min-h-0">
          {/* Keyed by group: a switch mid-draft must not carry the reply or the edit into the new group. */}
          <PeerGroupChat
            key={groupId}
            groupId={groupId}
            groupName={group.name}
            readerId={reader.id}
            readerName={reader.displayName}
            readerCid={selfCid(tab, connectionInfo)}
            sendRestriction={groupRestriction(listedAsMember, myRole !== undefined, can('sendMessages'))}
          />
        </div>
      )}

      {/* Settings Panel */}
      <GroupSettingsPanel
        open={showSettings}
        onOpenChange={setShowSettings}
        tab={settingsTab}
        onTabChange={setSettingsTab}
        group={group}
        onNameChange={onNameChange}
        onSettingsChange={onSettingsChange}
        onMemberRoleChange={handleRoleChange}
        onKickMember={handleKickMember}
        invitablePeers={invitable}
        onInviteMember={handleInviteMember}
        onDeleteGroup={onDeleteGroup}
      />
      </div>
    </AppLayout>
  );
}

export default GroupChatPage;
