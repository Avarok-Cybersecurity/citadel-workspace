/**
 * A direct chat: the shared chat pane over the peer transport, with the peer's own header.
 *
 * Everything a conversation does lives in the pane (components/chat/pane) and the transport
 * (lib/chat/transport); this builds the peer's adapter and the parts of a 1:1 Citadel session
 * that are not chat (connection route, supervisor, pause, the call, the screenshot notice).
 */
import { useMemo } from 'react';
import { NoConversation } from './NoConversation';
import { peerOpeningPorts } from './chat-document/use-chat-documents';
import { PeerChatTop } from './PeerChatTop';
import { useDirectCall, type DirectCallBinding } from './hooks/use-direct-call';
import { useConnectionRoute } from './hooks/use-connection-route';
import { useSupervisorState } from './hooks/use-supervisor-state';
import { useChatInterest } from './hooks/use-chat-interest';
import { usePeerPause, type PeerPauseBinding } from './hooks/use-peer-pause';
import { useScreenshotNotice, sendScreenshotNotice } from './hooks/useScreenshotNotice';
import { useShareLauncher, type ShareLauncher } from '@/components/share/use-share-launcher';
import { ChatPane, type ChatPaneStatus } from '@/components/chat/pane/ChatPane';
import { createPeerTransport } from '@/lib/chat/transport/peer-transport';
import type { ChatTransport } from '@/lib/chat/transport/chat-transport';
import type { ChatPeer } from '@/lib/cdoc/chat/chat-app-ports';
import type { SupervisorState } from '@/types/agent-supervisor';
import type { PeerPathReport } from '@/types/ice-servers';

interface P2PChatProps {
  peerCid: bigint;
  peerName?: string;
  /** The roster key behind `peerName`. Absent when the caller only knows a display name; the picture then falls back to initials. */
  peerUsername?: string;
  currentUserCid?: bigint;
  currentUserName?: string;
}

export function P2PChat({ peerCid, peerName = 'Peer', peerUsername, currentUserCid, currentUserName = 'You' }: P2PChatProps): JSX.Element {
  // Hooks first, before the early return below: placed after one, React's hook order breaks
  // intermittently at runtime rather than reliably.
  const call: DirectCallBinding = useDirectCall(peerCid, peerName);
  useScreenshotNotice(peerCid, sendScreenshotNotice); // best effort: see screenshot-detection.ts
  const peer: ChatPeer = useMemo((): ChatPeer => ({ cid: peerCid, name: peerName, username: peerUsername ?? peerName }), [peerCid, peerName, peerUsername]);
  const transport: ChatTransport = useMemo((): ChatTransport => createPeerTransport({
    peer,
    self: currentUserCid === undefined ? null : { cid: currentUserCid, username: currentUserName, displayName: currentUserName },
    opening: peerOpeningPorts(peer),
  }), [peer, currentUserCid, currentUserName]);
  const route: PeerPathReport | null = useConnectionRoute(currentUserCid ?? null, peerCid);
  const supervisor: SupervisorState | null = useSupervisorState(currentUserCid ?? null, peerCid);
  useChatInterest(currentUserCid ?? null, peerCid);
  // Paused: the link is down on purpose. Messages still send and queue; calls and files need the
  // live link, so those say why they are unavailable.
  const pause: PeerPauseBinding = usePeerPause(peerCid);
  const share: ShareLauncher = useShareLauncher();

  if (!peerCid) return <NoConversation />;
  return (
    <ChatPane
      transport={transport}
      pause={pause.status}
      header={(status: ChatPaneStatus) => (
        <PeerChatTop peer={peer} knowsUsername={peerUsername !== undefined} status={status} pause={pause} call={call} share={share} route={route} supervisor={supervisor} />
      )}
    />
  );
}
