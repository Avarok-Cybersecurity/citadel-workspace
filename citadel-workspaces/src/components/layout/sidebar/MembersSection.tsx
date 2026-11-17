/** Sidebar section displaying workspace members, P2P peers, and conversations. */

import { Plus } from "lucide-react";
import { MemberListBody } from './MemberListBody';
import { PendingRequestsBadge } from './PendingRequestsBadge';
import { membersSectionLabel } from './members-section-label';
import { MembersHeaderActions } from './MembersHeaderActions';
import { connectionManager } from '@/lib/connection';
import { useLocation } from "react-router-dom";
import { activeConversation, type ActiveConversation } from "./active-conversation";
import { useOpenConversation } from './use-open-conversation';
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { Button } from "@/components/ui/button";
import { useState, useEffect, useCallback } from "react";
import { getEntityMetadata } from "@/lib/entity-type-registry";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { peerRegistrationStore } from "@/lib/peer-registration-store";
import { GroupConversationRow } from "./GroupConversationRow";
import { GroupInviteList } from "./GroupInviteList";
import { PausablePeerRow } from "./PausablePeerRow";
import { useGroupConversations, useRegisteredPeers, useConversationPeers, useEventListener } from '@/hooks';
import { useDomainMembers } from '@/hooks/use-domain-members';
import { debugLog } from '@/lib/debug-config';
import type { User as WorkspaceMember } from '@/types/workspace-entities';
import { MembersSectionModals } from './MembersSectionModals';
import { WORKSPACE_ROOT_ID } from '@/lib/workspace-constants';
import type { RegisteredPeer } from '@/hooks/use-registered-peers';
import type { DomainNode } from '@/components/layout/sidebar/tree-node-types';

export const MembersSection: () => JSX.Element = (): JSX.Element => {
  const location: ReturnType<typeof useLocation> = useLocation();
  const [showInvite, setShowInvite] = useState(false);
  const { state } = useWorkspace();
  const params: URLSearchParams = new URLSearchParams(location.search);
  const currentNodeId: string | null = params.get("nodeId");

  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showRemoveModal, setShowRemoveModal] = useState(false);
  const [selectedMember, setSelectedMember] = useState<WorkspaceMember | null>(null);
  const [showAllMembersDialog, setShowAllMembersDialog] = useState(false);
  const [showPermissionModal, setShowPermissionModal] = useState(false);
  const [permissionModalData, setPermissionModalData] = useState<{
    member: WorkspaceMember; domainId: string;
  } | null>(null);
  const [showPeerDiscovery, setShowPeerDiscovery] = useState(false);
  const [showPendingRequests, setShowPendingRequests] = useState(false);
  const [pendingRequestCount, setPendingRequestCount] = useState(0);
  const [showCreateGroupDialog, setShowCreateGroupDialog] = useState(false);

  const { groups: groupConversations, createGroup } = useGroupConversations();
  const { registeredPeers } = useRegisteredPeers();
  const { peersWithConversations, conversationsLoaded } = useConversationPeers({ registeredPeers });

  const conversationPeerCids: Set<string> = new Set(peersWithConversations.map(c => c.peerCid));
  const filteredRegisteredPeers: RegisteredPeer[] = registeredPeers.filter(p => !conversationPeerCids.has(p.cid));

  const updatePendingCount: () => Promise<void> = useCallback(async (): Promise<void> => {
    const count: number = await peerRegistrationStore.getPendingCount();
    setPendingRequestCount(count);
  }, []);

  useEffect(() => {
    updatePendingCount().catch((err: unknown) => debugLog('MembersSection', 'Failed to update pending count:', err));
  }, [updatePendingCount]);

  useEventListener('peer-requests:updated', () => {
    updatePendingCount().catch((err: unknown) => debugLog('MembersSection', 'Failed to update pending count:', err));
  });

  useEventListener('open-pending-requests-modal', () => { setShowPendingRequests(true); });

  // No node selected is the workspace view, whose members are the root's.
  const activeDomainId: string = currentNodeId ?? WORKSPACE_ROOT_ID;
  const { members, isLoadingMembers, membersUnavailable, membersHidden } = useDomainMembers(activeDomainId);

  const handleEditMember = (m: WorkspaceMember): void => { setSelectedMember(m); setShowEditModal(true); };
  const handleRemoveMember = (m: WorkspaceMember): void => { setSelectedMember(m); setShowRemoveModal(true); };
  // The level on screen: this member's permissions THERE are what the editor is about.
  const handleManagePermissions = (member: WorkspaceMember): void => {
    setPermissionModalData({ member, domainId: activeDomainId });
    setShowPermissionModal(true);
  };

  // Which row to mark as the one on screen. Derived from the route rather than
  // held as state, so it cannot drift from what is actually rendered.
  const active: ActiveConversation = activeConversation(location.pathname, location.search);

  const handlePeerClick: (cid: string, username: string) => Promise<void> = useOpenConversation();

  const getLocationText = (): string => {
    const node: DomainNode | undefined = currentNodeId ? state.nodes[currentNodeId] : undefined;
    return membersSectionLabel({
      entityLabel: node ? getEntityMetadata(node.entity_type).label : undefined,
    });
  };

  return (
    <>
      <SidebarGroup className="flex-shrink-0 min-h-[4rem] mb-4">
        <div className="flex items-center justify-between gap-2 px-3 mb-2">
          <div className="flex min-w-0 items-center gap-2">
            <SidebarGroupLabel className="text-primary-accent font-semibold m-0 px-0 min-w-0 shrink truncate" title={getLocationText()}>
              {getLocationText().toUpperCase()}
            </SidebarGroupLabel>
            <PendingRequestsBadge count={pendingRequestCount} onOpen={() => setShowPendingRequests(true)} />
          </div>
          <MembersHeaderActions
            onDiscover={() => setShowPeerDiscovery(true)}
            onInvite={() => setShowInvite(true)}
            onAddMember={() => setShowAddModal(true)}
            domainId={activeDomainId}
          />
        </div>
        <SidebarGroupContent>
          <ScrollArea className="max-h-[30vh]">
            <SidebarMenu>
              <MemberListBody
                isLoading={isLoadingMembers}
                activeDomainId={activeDomainId}
                members={members}
                peerCount={filteredRegisteredPeers.length + registeredPeers.length}
                contacts={registeredPeers}
                membersUnavailable={membersUnavailable}
                membersHidden={membersHidden}
                currentUsername={state.currentUser?.username}
                onEditMember={handleEditMember}
                onRemoveMember={handleRemoveMember}
                onManagePermissions={handleManagePermissions}
                onShowAllMembers={() => setShowAllMembersDialog(true)}
              />
            </SidebarMenu>
          </ScrollArea>

          {filteredRegisteredPeers.length > 0 && (
            <div className="mt-2 border-t border-card pt-2">
              <SidebarMenu>
                {filteredRegisteredPeers.map((peer) => (
                  <PausablePeerRow key={peer.cid} cid={peer.cid} username={peer.username} displayName={peer.displayName} isOnline={peer.isOnline} isConnected={peer.isConnected} connectionPath={peer.connectionPath} isActive={peer.cid === active.peerCid} onClick={() => void handlePeerClick(peer.cid, peer.username)} />
                ))}
              </SidebarMenu>
            </div>
          )}
        </SidebarGroupContent>
      </SidebarGroup>

      {/* Shown when there is anyone to talk to, not once a conversation already
          exists. The only control that opens the create-group dialog lives in
          here, so gating on conversations meant nobody could create their FIRST
          group: you needed a conversation to get the button that starts one.
          Still hidden with no peers at all -- a create-group dialog with nobody
          to add is a dead end, and offering it is worse than not. */}
      <GroupInviteList />
      {(registeredPeers.length > 0 || groupConversations.length > 0) && (
        <SidebarGroup className="flex-shrink-0 min-h-[2rem] mb-4">
          <div className="flex items-center justify-between px-3">
            <SidebarGroupLabel className="text-primary-accent font-semibold text-xs px-0">CONVERSATIONS</SidebarGroupLabel>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="sm" aria-label="New group chat" data-testid="new-group-chat-button" className="tap-target h-6 w-6 p-0 text-primary-accent hover:text-primary-foreground hover:bg-primary" onClick={() => setShowCreateGroupDialog(true)}>
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent><p>New Group Chat</p></TooltipContent>
            </Tooltip>
          </div>
          <SidebarGroupContent>
            <SidebarMenu>
              {peersWithConversations.map((conv) => (
                <PausablePeerRow key={conv.peerCid} cid={conv.peerCid} username={conv.peerUsername} displayName={conv.peerDisplayName} isOnline={conv.isOnline} isConnected={conv.isConnected} connectionPath={conv.connectionPath} unreadCount={conv.unreadCount} isActive={conv.peerCid === active.peerCid} onClick={() => void handlePeerClick(conv.peerCid, conv.peerUsername)} />
              ))}
              {groupConversations.map((group) => (
                <GroupConversationRow key={group.id} group={group} isActive={group.id === active.groupId} />
              ))}
              {conversationsLoaded && peersWithConversations.length === 0 && groupConversations.length === 0 && (
                <SidebarMenuItem className="px-3 py-2 text-sm text-muted-foreground">
                  No conversations yet. Pick somebody above, or use the button to
                  start a group.
                </SidebarMenuItem>
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      )}

      <MembersSectionModals
        currentNodeId={currentNodeId}
        currentUsername={state.currentUser?.username}
        members={members}
        registeredPeers={registeredPeers}
        locationText={getLocationText()}
        showAddModal={showAddModal}
        showEditModal={showEditModal}
        showRemoveModal={showRemoveModal}
        showAllMembersDialog={showAllMembersDialog}
        showPermissionModal={showPermissionModal}
        showPeerDiscovery={showPeerDiscovery}
        showPendingRequests={showPendingRequests}
        showCreateGroupDialog={showCreateGroupDialog}
        selectedMember={selectedMember}
        permissionModalData={permissionModalData}
        onSetShowAddModal={setShowAddModal}
        onSetShowEditModal={setShowEditModal}
        onSetShowRemoveModal={setShowRemoveModal}
        onSetShowAllMembersDialog={setShowAllMembersDialog}
        onSetShowPermissionModal={setShowPermissionModal}
        showInvite={showInvite}
        onSetShowInvite={setShowInvite}
        workspaceName={state.workspace?.name || 'this workspace'}
        serverAddress={connectionManager.getConnectionInfo()?.serverAddress}
        onSetShowPeerDiscovery={setShowPeerDiscovery}
        onSetShowPendingRequests={setShowPendingRequests}
        onSetShowCreateGroupDialog={setShowCreateGroupDialog}
        onClearSelectedMember={() => setSelectedMember(null)}
        onClearPermissionModalData={() => setPermissionModalData(null)}
        onEditMember={handleEditMember}
        onRemoveMember={handleRemoveMember}
        onManagePermissions={handleManagePermissions}
        onCreateGroup={createGroup}
      />

    </>
  );
};
