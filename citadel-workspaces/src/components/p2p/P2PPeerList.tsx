import React, { useState, useEffect, useCallback } from 'react';
import { usePeerRequest } from './use-add-peer';
import { PeerDiscoveryModal } from './PeerDiscoveryModal';
import { useNavigate } from 'react-router-dom';
import type { NavigateFunction } from 'react-router';
import { P2PMessengerManager } from '@/lib/p2p';
import { p2pRegistrationService, type Peer } from '@/lib/p2p-registration-service';
import { ScrollArea } from '@/components/ui/scroll-area';
import { MemberAvatar } from '@/components/shared/MemberAvatar';
import { Button } from '@/components/ui/button';
import { UserPlus, MessageCircle, Users, CheckCircle } from 'lucide-react';
import { useEventListener } from '@/hooks';
import { runAsyncSetup } from '@/lib/utils/async-utils';
import { debugLog } from '@/lib/debug-config';
import { conversationPeerName, conversationPeerUsername, type PeerInfo } from './P2PPeerListHelpers';
import { ConversationPeerItem } from './ConversationPeerItem';
import { peerDisplayName, peerHandleName, isUnnamedPeer } from '@/lib/peer-display';
import type { P2PConversation, P2PMessage } from '@/lib/p2p/p2p-types';

interface P2PPeerListProps {
  onSelectPeer: (peerCid: string) => void;
  selectedPeerCid?: string;
}

export function P2PPeerList({ onSelectPeer, selectedPeerCid }: P2PPeerListProps): JSX.Element {
  const [peers, setPeers] = useState<PeerInfo[]>([]);
  const [availablePeers, setAvailablePeers] = useState<Peer[]>([]);
  const [showAvailablePeers, setShowAvailablePeers] = useState(false);

  const messenger: P2PMessengerManager = P2PMessengerManager.getInstance();

  const loadPeers: () => void = useCallback((): void => {
    const conversations: P2PConversation[] = messenger.getAllConversations();
    const { allPeers } = p2pRegistrationService.getPeers();
    const peerList: PeerInfo[] = conversations.map(conv => {
      const lastMessage: P2PMessage = conv.messages[conv.messages.length - 1];
      const peerCidStr: string = conv.peerCid.toString();
      return {
        cid: peerCidStr,
        name: conversationPeerName(conv.peerCid, conv.peerUsername, allPeers),
        username: conversationPeerUsername(conv.peerCid, conv.peerUsername, allPeers),
        isConnected: messenger.isConnected(conv.peerCid),
        unreadCount: conv.unreadCount,
        lastMessage: lastMessage?.content,
        lastMessageTime: lastMessage?.timestamp
      };
    });

    peerList.sort((a, b) => (b.lastMessageTime || 0) - (a.lastMessageTime || 0));
    setPeers(peerList);
  }, [messenger]);

  useEffect(() => {
    const initPeers = async (): Promise<void> => {
      await messenger.waitForReady();
      await messenger.syncConnectionsFromBackend();
      loadPeers();
      loadAvailablePeers();
    };
    initPeers().catch(err => debugLog('P2PPeerList', 'Failed to init peers:', err));

    const unsubscribeMessage: () => void = messenger.onMessage((): void => {
      loadPeers();
    });

    const unsubscribeConnection: () => void = messenger.onConnectionChange((): void => {
      loadPeers();
    });

    return (): void => {
      unsubscribeMessage();
      unsubscribeConnection();
    };
  }, [loadPeers, messenger]);

  const handlePeersUpdated: (data: { allPeers: Peer[]; registeredPeers: Peer[]; }) => void = useCallback((data: { allPeers: Peer[]; registeredPeers: Peer[] }): void => {
    setAvailablePeers(data.allPeers);
    loadPeers();
  }, [loadPeers]);

  useEventListener<{ allPeers: Peer[]; registeredPeers: Peer[] }>('p2p:peers-updated', handlePeersUpdated);
  useEventListener('p2p:messages-loaded', loadPeers);

  const loadAvailablePeers = (): void => {
    const { allPeers } = p2pRegistrationService.getPeers();
    setAvailablePeers(allPeers);
  };

  const [showDiscovery, setShowDiscovery] = useState(false);
  const navigate: NavigateFunction = useNavigate();
  // One click on someone in the Available list sends them a request, recorded under the name they are addressed by.
  const handleOf = (cid: bigint): string => peerHandleName({ cid, username: availablePeers.find((p: Peer): boolean => p.cid === cid)?.username });
  const { error: addPeerError, request: sendRequest } = usePeerRequest((cid) => messenger.autoRegisterPeer(cid, handleOf(cid)), loadPeers);

  return (
    <div className="h-full flex flex-col bg-input">
      <div className="px-4 py-3 border-b border-border">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <MessageCircle className="h-4 w-4 text-primary-accent" />
            Direct Messages
          </h3>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowAvailablePeers(!showAvailablePeers)}
            data-testid="messages-available-toggle"
            className="h-7 text-muted-foreground hover:text-foreground text-xs gap-1"
          >
            <Users className="h-3.5 w-3.5" />
            {availablePeers.length}
          </Button>
        </div>
      </div>

      <div className="flex-1 p-0 flex flex-col">
        <div className="p-3 border-b border-border">
          {/* It asked for a "Peer CID": a number no screen shows. People are found by name. */}
          <Button
            type="button"
            variant="outline"
            onClick={() => setShowDiscovery(true)}
            className="w-full h-9 justify-start gap-2 rounded-lg text-sm"
            data-testid="messages-find-people"
          >
            <UserPlus className="h-4 w-4" aria-hidden="true" />
            Find people to message
          </Button>
          {addPeerError && (
            // role="alert" so a screen reader announces it, not only shows it.
            <p id="add-peer-error" role="alert" className="mt-2 text-xs text-destructive-emphasis">
              {addPeerError}
            </p>
          )}
        </div>

        <ScrollArea className="flex-1">
          <div className="p-2">
            {showAvailablePeers && (
              <div className="mb-4">
                <div className="text-sm font-medium text-muted-foreground mb-2 px-2">
                  Available Peers ({availablePeers.length})
                </div>
                <div className="space-y-1">
                  {availablePeers.map((peer) => {
                    const peerCidStr: string = peer.cid.toString();
                    return (
                    <Button
                      key={peerCidStr}
                      data-testid="messages-available-peer"
                      data-peer-username={peerHandleName({ cid: peer.cid, username: peer.username })}
                      variant="ghost"
                      className="w-full justify-start h-auto py-2 px-3"
                      onClick={() => {
                        if (!peer.isRegistered) {
                          runAsyncSetup(() => sendRequest(peer.cid));
                        } else {
                          onSelectPeer(peerCidStr);
                        }
                      }}
                    >
                      <div className="flex items-center gap-3 w-full">
                        <MemberAvatar username={peerHandleName({ cid: peer.cid, username: peer.username })} name={peerDisplayName({ cid: peer.cid, username: peer.username, fullName: peer.fullName })} className="h-8 w-8" />

                        <div className="flex-1 text-left">
                          <div className="font-medium text-sm">
                            {peerDisplayName({ cid: peer.cid, username: peer.username, fullName: peer.fullName })}
                          </div>
                          {isUnnamedPeer({ cid: peer.cid, username: peer.username, fullName: peer.fullName }) && (
                            <div className="text-xs text-muted-foreground">
                              Name not shared yet
                            </div>
                          )}
                        </div>

                        {peer.isRegistered ? (
                          <CheckCircle className="h-4 w-4 text-success-emphasis" />
                        ) : (
                          <UserPlus className="h-4 w-4 text-muted-foreground" />
                        )}
                      </div>
                    </Button>
                    );
                  })}
                </div>
                <div className="my-4 border-b" />
              </div>
            )}
            {peers.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <MessageCircle className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p className="text-sm">No conversations yet</p>
                {/* This said "Add a peer to start messaging" and pointed at an
                    input that wants a CID -- an internal identifier no screen
                    in the app displays, under an acronym the reader was never
                    told. The two paths that actually work are named here
                    instead. */}
                <p className="text-xs mt-1">
                  Find someone in the workspace directory, or use Discover Peers
                  in the sidebar.
                </p>
              </div>
            ) : (
              <div className="space-y-1">
                {peers.map((peer) => (
                  <ConversationPeerItem
                    key={peer.cid}
                    peer={peer}
                    isSelected={selectedPeerCid === peer.cid}
                    onSelect={onSelectPeer}
                  />
                ))}
              </div>
            )}
          </div>
        </ScrollArea>
      </div>
      <PeerDiscoveryModal isOpen={showDiscovery} onClose={() => setShowDiscovery(false)} onOpenDirectory={() => { setShowDiscovery(false); navigate('/directory'); }} />
    </div>
  );
}
