import { isPlaceholderName } from '@/lib/peer-display';
import { useSelfName, type SelfName } from '@/hooks/use-self-name';
import { selfCid } from '@/lib/tab-identity';
import { AppLayout } from "@/components/layout/AppLayout";
import { P2PPeerList } from "@/components/p2p/P2PPeerList";
import { P2PChat } from "@/components/p2p/P2PChat";
import { useLocation, useNavigate } from "react-router-dom";
import { MessageCircle, Shield, ChevronLeft } from "lucide-react";
import { useState, useEffect, useMemo } from "react";
import { connectionManager } from "@/lib/connection";
import { useRegisteredPeers } from "@/hooks";
import { peerDisplayName } from "@/lib/peer-display";
import { tryParseCid } from '@/lib/utils/cid-utils';
import { workspacePeerWithCid } from '@/lib/workspace-peers';
import type { NavigateFunction } from 'react-router';
import type { RegisteredPeer } from '@/hooks/use-registered-peers';

const Messages: () => JSX.Element = (): JSX.Element => {
  const location: ReturnType<typeof useLocation> = useLocation();
  const navigate: NavigateFunction = useNavigate();
  // Parsed, not trusted. `?channel=` comes straight from the URL and was handed
  // to `BigInt(...)` during render — so `/messages?channel=abc` threw a
  // SyntaxError mid-render and took the whole app to the error boundary, not a
  // per-page fallback. `WorkspaceView` funnels this same param through
  // `tryParseCid`, with a comment calling `params.get('channel')` "the
  // historical crash surface"; the fix was applied there and not here.
  const channelParam: string | null = new URLSearchParams(location.search).get("channel");
  const channel: string | null = tryParseCid(channelParam) === undefined ? null : channelParam;
  const [selectedPeerCid, setSelectedPeerCid] = useState<string | null>(channel);
  const parsedPeerCid: bigint | undefined = tryParseCid(selectedPeerCid);
  const { registeredPeers } = useRegisteredPeers();

  // The tab's identity first, the connection's second -- see selfCid. The
  // connection's alone gated the whole chat, and the tab identity is what
  // re-renders this page when it lands.
  const self: SelfName = useSelfName();
  const currentUserCid: bigint | undefined = selfCid(self, connectionManager.getConnectionInfo());
  const currentUserName: string = self.name || 'You';

  // The roster key for the peer's picture and their connect request; `selectedPeerName` below is
  // a display name. A contact's, else -- a colleague not connected yet -- the agent's listing.
  const selectedPeerUsername: string | undefined = useMemo((): string | undefined => {
    const username: string | undefined = registeredPeers.find((p: RegisteredPeer) => p.cid === selectedPeerCid)?.username
      ?? (parsedPeerCid === undefined ? undefined : workspacePeerWithCid(parsedPeerCid)?.username);
    return isPlaceholderName(username) ? undefined : username;
  }, [selectedPeerCid, parsedPeerCid, registeredPeers]);

  // peerDisplayName, not a truncated CID: the decimal prefix is unreadable and
  // identical for peers whose CIDs share leading digits. See lib/peer-display.
  const selectedPeerName: string = selectedPeerCid ? peerDisplayName({ cid: selectedPeerCid, username: selectedPeerUsername }) : '';

  // Sync URL param with selected peer
  useEffect(() => {
    setSelectedPeerCid(channel);
  }, [channel]);

  const handleSelectPeer = (peerCid: string): void => {
    setSelectedPeerCid(peerCid);
    navigate(`/messages?channel=${peerCid}`, { replace: true });
  };

  return (
    <AppLayout>
      <div className="flex h-full">
        {/* Conversation List.
            Master-detail below `md`: one pane at a time, because a 288px list
            beside a flex-1 detail left the detail 87px wide at 375px and broke
            its text mid-word. Above `md` both show, exactly as before. */}
        <div
          className={`w-full md:w-72 border-r border-border bg-input flex-shrink-0 flex-col ${
            selectedPeerCid ? 'hidden md:flex' : 'flex'
          }`}
        >
          <div className="sr-only">
            {/* The page had no h1 at all: it opened at this h2, so a screen
                reader listing headings found no page title to start from.
                sr-only because the visible design has no room for one and does
                not need it — the pane labels carry the visual hierarchy. */}
            <h1 className="sr-only">Messages</h1>
            {/* The list below carries its own visible title ("Direct Messages"); a second one
                stacked above it named the same list twice. */}
            <h2>Conversations</h2>
          </div>
          <div className="flex-1 overflow-y-auto">
            <P2PPeerList
              onSelectPeer={handleSelectPeer}
              selectedPeerCid={selectedPeerCid || undefined}
            />
          </div>
        </div>

        {/* Chat Area — hidden below `md` until a peer is chosen, so the list
            gets the whole screen rather than a sliver of it. */}
        <div
          className={`flex-1 flex-col bg-background ${
            selectedPeerCid ? 'flex' : 'hidden md:flex'
          }`}
        >
          {/* The way back, mobile only, and whenever a peer is chosen -- the
              list is hidden then, whatever this pane goes on to show.
              Lives here and not in P2PChat: that component also renders
              office and room chat, where "back to conversations" is not a
              place the user came from. Full-screen chat without this would
              strand a phone user in a conversation with no exit. */}
          {selectedPeerCid && (
            <button
              type="button"
              onClick={() => {
                setSelectedPeerCid(null);
                navigate('/messages', { replace: true });
              }}
              className="md:hidden flex items-center gap-2 px-4 py-3 border-b border-border text-sm text-muted-foreground hover:text-foreground"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              Conversations
            </button>
          )}
          {/* Not gated on currentUserCid: P2PChat takes it as optional, and
              WorkspaceView renders the same chat without it. */}
          {parsedPeerCid !== undefined ? (
            <>
              {/* Keyed by the conversation, so React resets this subtree on a switch.
                  Without it the same component instance is reused: useP2PMessages'
                  only reset path fires on a FALSY peerCid, and mergeMessages
                  dedups by message id alone — never by peer — so the previous
                  peer's messages stayed in state and were merged into the new
                  thread by timestamp. P2PMessageList then labels every
                  non-own message with the CURRENT peerName, so they rendered
                  as if that peer had sent them. */}
              <P2PChat
                key={selectedPeerCid}
                peerCid={parsedPeerCid}
                peerName={selectedPeerName}
                peerUsername={selectedPeerUsername}
                currentUserCid={currentUserCid}
                currentUserName={currentUserName}
              />
            </>
          ) : (
            <div className="h-full flex flex-col items-center justify-center">
              <div className="flex flex-col items-center max-w-xs text-center">
                <div className="w-16 h-16 rounded-2xl bg-primary-accent/10 flex items-center justify-center mb-5">
                  <MessageCircle className="h-8 w-8 text-primary-accent" />
                </div>
                <h3 className="text-lg font-semibold text-foreground mb-2">No conversation selected</h3>
                <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
                  Choose a peer from the list to start an encrypted conversation
                </p>
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary-accent/5 border border-primary-accent/10">
                  <Shield className="w-3.5 h-3.5 text-primary-accent" />
                  <span className="text-xs text-muted-foreground">End-to-end encrypted</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
};

export default Messages;
