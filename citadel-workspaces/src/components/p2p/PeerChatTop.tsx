/**
 * What sits above a direct chat's tabs: the peer's header, the banners that belong to a 1:1
 * Citadel session (paused, waiting for their acceptance) and the docked call. These are
 * properties of the session, not of a chat, so they stay out of the shared pane.
 */
import { P2PChatHeader } from './P2PChatHeader';
import { PausedBanner } from './PausedBanner';
import { ConnectRequestBanner } from './ConnectRequestBanner';
import { DockedCall } from './DockedCall';
import { usePeerFilesOpener } from './hooks/use-peer-files-opener';
import { callCapabilityWhile } from '@/lib/p2p-pause/pause-copy';
import type { DirectCallBinding } from './hooks/use-direct-call';
import type { PeerPauseBinding } from './hooks/use-peer-pause';
import type { ShareLauncher } from '@/components/share/use-share-launcher';
import type { SupervisorState } from '@/types/agent-supervisor';
import type { PeerPathReport } from '@/types/ice-servers';
import type { ChatPaneStatus } from '@/components/chat/pane/ChatPane';
import type { ChatPeer } from '@/lib/cdoc/chat/chat-app-ports';

interface PeerChatTopProps {
  peer: ChatPeer;
  /** Whether the caller knew the peer's roster key; without it there is nothing to share. */
  knowsUsername: boolean;
  status: ChatPaneStatus;
  pause: PeerPauseBinding;
  call: DirectCallBinding;
  share: ShareLauncher;
  route: PeerPathReport | null;
  supervisor: SupervisorState | null;
}

export function PeerChatTop({ peer, knowsUsername, status, pause, call, share, route, supervisor }: PeerChatTopProps): JSX.Element {
  const openFiles: (() => void) | null = usePeerFilesOpener(peer.cid, status.accepted);
  const paused: boolean = pause.status === 'paused';
  return (
    <>
      <P2PChatHeader
        peerName={peer.name}
        peerUsername={peer.username}
        peerPresence={status.presence}
        peerTyping={status.typing.length > 0}
        isConnected={status.connected}
        isRegistered={status.accepted}
        paused={paused}
        connectionRoute={route}
        supervisor={supervisor}
        onSettingsClick={status.openSettings ?? ((): void => undefined)}
        onOpenFiles={openFiles}
        onShare={knowsUsername ? (): void => share.open({ kind: 'peer-chat', peerUsername: peer.username, peerName: peer.name }) : undefined}
        call={{
          canCall: status.connected,
          inCall: call.active,
          capability: callCapabilityWhile(pause.status, call.capability),
          onStartCall: call.startCall,
          onLeave: call.leave,
        }}
      />
      {share.dialog}
      {paused && <PausedBanner busy={pause.busy} onResume={pause.resume} />}
      <ConnectRequestBanner peerCid={peer.cid} peerName={peer.name} peerUsername={knowsUsername ? peer.username : undefined} registered={status.accepted} />
      <DockedCall binding={call} />
    </>
  );
}
