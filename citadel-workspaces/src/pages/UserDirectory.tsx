import React, { useEffect, useMemo, useState } from 'react';
import { reachablePeer } from './reachable-peer';
import { DirectoryTabContent } from './DirectoryTabContent';
import { describeFailure } from '@/lib/failure-message';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { UserSearch, UserData } from '@/components/user/UserSearch';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from '@/hooks/use-toast';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { debugLog } from '@/lib/debug-config';
import { eventEmitter } from '@/lib/event-emitter';
import { isMemberOnline, ownPresence } from '@/lib/presence';
import { websocketService } from '@/lib/websocket-service';
import { useSelfName } from '@/hooks/use-self-name';
import { type MemberDisplay } from './MemberListItem';
import { UserProfileCard } from './UserProfileCard';
import { ConnectionRequestDialog } from './ConnectionRequestDialog';
import { useDomainMembers } from '@/hooks/use-domain-members';
import { AppLayout } from '@/components/layout/AppLayout';
import { useRegisteredPeers } from '@/hooks';
import { usePeerDiscovery  , type Peer } from '@/components/p2p/usePeerDiscovery';
import type { NavigateFunction } from 'react-router';
import type { RegisteredPeer } from '@/hooks/use-registered-peers';

export const UserDirectory: () => JSX.Element = (): JSX.Element => {
  const { state } = useWorkspace();
  const [selectedUser, setSelectedUser] = useState<UserData | null>(null);
  const [tab, setTab] = useState('all');
  const [sendingRequest, setSendingRequest] = useState(false);
  const { registeredPeers } = useRegisteredPeers();
  // The only source that carries a username AND a cid, which registration needs --
  // and the discovery dialog's own send, so both surfaces share one request path.
  const { peers: discoveredPeers, registerWithPeer } = usePeerDiscovery(true);
  const [requestDialogOpen, setRequestDialogOpen] = useState(false);
  const navigate: NavigateFunction = useNavigate();

  // Request member list on mount
  const [searchParams] = useSearchParams();
  const domainIdParam: string | undefined = searchParams.get('nodeId') || state.workspace?.id;
  // The request, and whether the answer has arrived: `listMembers` resolves when the request is
  // SENT, so "no members" before the reply is not a fact about the workspace.
  const { isLoadingMembers, membersUnavailable } = useDomainMembers(domainIdParam ?? null);

  // This tab's account, from the one reader the top bar uses; state.currentUser is unset on resumed tabs.
  const { username: selfUsername, cid: selfCid } = useSelfName();

  // Re-read presence whenever the registry's poll lands; the answer itself
  // comes from isMemberOnline, as UserSearch's does.
  const [presenceVersion, setPresenceVersion] = useState<number>(0);
  useEffect(() => {
    const bump: () => void = (): void => setPresenceVersion((v: number): number => v + 1);
    eventEmitter.on('p2p:peers-updated', bump);
    eventEmitter.on('websocket-disconnected', bump);
    return (): void => {
      eventEmitter.off('p2p:peers-updated', bump);
      eventEmitter.off('websocket-disconnected', bump);
    };
  }, []);

  // One answer to "is this person a contact", for the rows and the card alike.
  const isUserConnected = (username: string): boolean =>
    registeredPeers.some((peer) => peer.username === username);

  const allMembers: MemberDisplay[] = useMemo(() => Object.values(state.members || {}).map(member => ({
    id: member.id,
    displayName: member.displayName,
    avatarUrl: member.avatarUrl,
    email: member.email,
    role: member.role,
    roleId: member.roleId,
    // Presence from the one reader of it (lib/presence.ts), which knows every
    // workspace peer the agent lists. This read the REGISTERED peers only, so
    // for anyone without a contact list the Online tab said "Everyone in this
    // workspace is currently offline" while they were online (live, admin-lab).
    isOnline: member.id === selfUsername ? ownPresence(selfCid, websocketService.canSendRequests()) : isMemberOnline(member.id),
    isSelf: member.id === selfUsername,
    isContact: isUserConnected(member.id),
    // Undefined, not 0: nothing tracks last-seen, and 0 rendered as 1970.
    lastActive: undefined,
  // eslint-disable-next-line react-hooks/exhaustive-deps -- presenceVersion is the re-read trigger
  })), [state.members, registeredPeers, presenceVersion, selfUsername, selfCid]);

  // Only an EMPTY list is unknown while the reply is in flight; one already in hand is shown as it is.
  const awaitingMembers: boolean = isLoadingMembers && allMembers.length === 0;

  const filteredMembers: MemberDisplay[] = allMembers.filter(member => {
    // `=== true`: a member whose presence nobody has reported is not evidence
    // of being online, and this tab asserts that they are.
    if (tab === 'online') return member.isOnline === true;
    return true;
  });

  // Opens the conversation whether or not they are a contact yet (owner, 2026-10-15): the chat
  // says you are not connected and offers the request, so there is no dead end here.
  //
  // By CID, under `?channel=`, which is what Messages selects a peer by. A member `id` is a
  // USERNAME, so the CID comes from the contact, else from the agent's listing.
  const handleSendMessage = (userId: string): void => {
    const contact: RegisteredPeer | undefined = registeredPeers.find((p) => p.username === userId);
    if (contact) {
      navigate(`/messages?channel=${contact.cid}`);
      return;
    }
    try {
      const member: { id: string; displayName: string } = allMembers.find((m) => m.id === userId) ?? { id: userId, displayName: userId };
      navigate(`/messages?channel=${reachablePeer(discoveredPeers, member).cid}`);
    } catch (error) {
      toast({
        title: 'Cannot open that conversation',
        description: describeFailure(error, 'This person cannot be reached yet.'),
        variant: 'destructive',
      });
    }
  };

  const handleInviteUser = (userId: string): void => {
    setSelectedUser(allMembers.find(member => member.id === userId) || null);
    setRequestDialogOpen(true);
  };

  const sendConnectionRequest = async (): Promise<void> => {
    if (!selectedUser) return;

    setSendingRequest(true);
    try {
      // `registerWithPeer`, the discovery dialog's send. This called
      // `sendPeerRegistration` itself, with `getConnectionInfo()`'s CID rather
      // than the tab's selected session that the hook resolves, and without
      // registering the request id, so a PeerRegisterFailure for it matched
      // nothing and the user kept a green "Request Sent" for a refused request.
      const peer: Peer = reachablePeer(discoveredPeers, selectedUser);
      if (await registerWithPeer(peer.cid, selectedUser.id, true)) setRequestDialogOpen(false);
    } catch (error) {
      debugLog('UserDirectory', 'Failed to send connection request:', error);
      toast({
        title: 'Error',
        description: describeFailure(error, 'Failed to send connection request'),
        variant: 'destructive',
      });
    } finally {
      setSendingRequest(false);
    }
  };

  const handleUserSelect = (user: UserData): void => {
    setSelectedUser(user);
  };

  return (
    <AppLayout>
    <div className="container mx-auto p-4 md:p-6 max-w-6xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground mb-2">User Directory</h1>
        <p className="text-muted-foreground">Find and connect with people in your workspace</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column - User search and directory */}
        <div className="lg:col-span-2 space-y-4">
          <Card className="bg-card border-border text-foreground shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle as="h2">Find People</CardTitle>
              <CardDescription className="text-muted-foreground">Search for users by name or email</CardDescription>
            </CardHeader>
            <CardContent>
              <UserSearch
                onUserSelect={handleUserSelect}
                enableInvite={true}
                exclude={selfUsername ? [selfUsername] : []}
                initialFocus={true}
              />
            </CardContent>
          </Card>

          <Card className="bg-card border-border text-foreground shadow-sm">
            <CardHeader className="pb-3">
              <div>
                <CardTitle as="h2">Workspace Directory</CardTitle>
                <CardDescription className="text-muted-foreground">
                  {awaitingMembers ? 'Loading members…' : `${filteredMembers.length} ${tab === 'online' ? 'online ' : ''}members`}
                </CardDescription>
              </div>
            </CardHeader>

            <Tabs defaultValue="all" value={tab} onValueChange={setTab} className="w-full">
              <div className="px-6">
                <TabsList className="bg-card w-full">
                  <TabsTrigger value="all" className="flex-1 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground text-muted-foreground">All</TabsTrigger>
                  <TabsTrigger value="online" className="flex-1 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground text-muted-foreground">Online</TabsTrigger>
                </TabsList>
              </div>

              {['all', 'online'].map(tabValue => (
                <TabsContent key={tabValue} value={tabValue} className="m-0">
                  <DirectoryTabContent
                    tab={tabValue as 'all' | 'online'}
                    members={filteredMembers}
                    totalMembers={allMembers.length}
                    loading={awaitingMembers}
                    unavailable={membersUnavailable}
                    presenceUnknown={allMembers.filter((m: MemberDisplay): boolean => m.isOnline === null).length}
                    onSendMessage={handleSendMessage}
                    onInvite={handleInviteUser}
                    onSelect={(userId) => setSelectedUser(allMembers.find((m) => m.id === userId) ?? null)}
                  />
                </TabsContent>
              ))}
            </Tabs>
          </Card>
        </div>

        {/* Right column - Selected user profile */}
        <div className="lg:col-span-1">
          <UserProfileCard
            selectedUser={selectedUser}
            isSelf={selectedUser?.id === selfUsername}
            isConnected={selectedUser ? isUserConnected(selectedUser.id) : false}
            onClose={() => setSelectedUser(null)}
            onSendMessage={handleSendMessage}
            onInvite={handleInviteUser}
          />
        </div>
      </div>

      <ConnectionRequestDialog
        open={requestDialogOpen}
        onOpenChange={setRequestDialogOpen}
        selectedUser={selectedUser}
        sendingRequest={sendingRequest}
        onSend={sendConnectionRequest}
      />
    </div>
    </AppLayout>
  );
};

export default UserDirectory;
