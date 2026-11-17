/**
 * P2PChatHeader Component
 *
 * Displays the chat header with peer avatar, name, status, typing indicator,
 * and settings button.
 */

import React from 'react';
import { MemberAvatar } from '@/components/shared/MemberAvatar';
import { Button } from '@/components/ui/button';
import { FolderOpen, Settings, Share2 } from 'lucide-react';
import { CallEntryButtons } from '@/components/call/CallEntryButtons';
import { MessagingLayerType } from '@/types/messaging-layer';
import type { PeerPresence } from '@/lib/p2p';
import { PAUSE_COPY } from '@/lib/p2p-pause/pause-copy';
import type { PeerPathReport } from '@/types/ice-servers';
import type { SupervisorState } from '@/types/agent-supervisor';
import { ConnectionPathLabel } from './ConnectionPathLabel';

interface P2PChatHeaderProps {
  peerName: string;
  /** Who the picture belongs to: the roster is keyed by username, `peerName` is for reading. */
  peerUsername: string;
  peerPresence: PeerPresence | null;
  peerTyping: boolean;
  isConnected: boolean;
  isRegistered: boolean;
  /** Paused by us: the link is down on purpose, so presence is not the story. */
  paused: boolean;
  /** How messages reach the peer now; shown only while the link is up. */
  connectionRoute: PeerPathReport | null;
  /** What the agent's supervisor says it is doing about the link; shown even while it is down. */
  supervisor: SupervisorState | null;
  onSettingsClick: () => void;
  /** The storage you share with this peer, in the file manager; null until you are registered peers. */
  onOpenFiles: (() => void) | null;
  /** Share this conversation; omitted where sharing is not wired up. */
  onShare?: () => void;
  /** Omitted where calling is not wired up, so the header stays usable. */
  call?: {
    canCall: boolean;
    inCall: boolean;
    capability: { supported: boolean; reason?: string };
    onStartCall: (video: boolean) => void;
    onLeave: () => void;
  };
}

interface StatusDisplay {
  text: string;
  color?: string;
  textColor: string;
  customColor?: string;
}

export function getStatusDisplay(
  presence: PeerPresence | null,
  connected: boolean,
  registered: boolean
): StatusDisplay {
  if (connected) {
    return { text: 'Online', color: 'bg-success', textColor: 'text-success-emphasis' };
  }

  // `registered` used to short-circuit here, and it is true for every peer you
  // can have a conversation with -- by construction, since the conversation
  // exists because the registration does. So every branch below was
  // unreachable: Away, Offline and the user's own custom status were sent by
  // the peer, received, routed and stored, and displayed nowhere. The one
  // surface designed to show presence showed the word "Registered" instead,
  // which is protocol vocabulary, not a state a person is in.
  //
  // Registration now only decides what "we know nothing" looks like: an
  // unregistered peer is genuinely unknown, a registered one with no presence
  // yet is offline.
  // Nothing has said either way: the honest label is the absence of one.
  if (presence === null) return { text: 'Status unknown', color: 'bg-muted-foreground', textColor: 'text-muted-foreground' };
  switch (presence.status) {
    case MessagingLayerType.Online:
      return { text: 'Online', color: 'bg-success', textColor: 'text-success-emphasis' };
    case MessagingLayerType.Away:
      return { text: 'Away', color: 'bg-warning', textColor: 'text-warning-emphasis' };
    case MessagingLayerType.Offline:
      return { text: 'Offline', color: 'bg-muted-foreground', textColor: 'text-muted-foreground' };
    case MessagingLayerType.CustomState:
      return {
        text: presence.customText || 'Custom',
        color: presence.customColor ? undefined : 'bg-primary',
        textColor: 'text-primary-accent',
        customColor: presence.customColor
      };
    default:
      return registered
        ? { text: 'Offline', color: 'bg-muted-foreground', textColor: 'text-muted-foreground' }
        : { text: 'Not connected', color: 'bg-muted-foreground', textColor: 'text-muted-foreground' };
  }
}

export function P2PChatHeader({
  peerName,
  peerUsername,
  peerPresence,
  peerTyping,
  isConnected,
  isRegistered,
  paused,
  connectionRoute,
  supervisor,
  onSettingsClick,
  onOpenFiles,
  onShare,
  call,
}: P2PChatHeaderProps): JSX.Element {
  const statusDisplay: StatusDisplay = paused
    ? { text: PAUSE_COPY.statusLabel, color: 'bg-warning', textColor: 'text-warning-emphasis' }
    : getStatusDisplay(peerPresence, isConnected, isRegistered);

  return (
    <div className="border-b border-surface/50 p-4 bg-background">
      <div className="flex items-center justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <MemberAvatar username={peerUsername} name={peerName} className="h-8 w-8" />
          {/* min-w-0, or the `truncate` below can never fire: a flex item
              defaults to min-width:auto, so this div never becomes narrower
              than the name's max-content width and a long peer name renders
              underneath the call and settings buttons. GroupChatHeader has
              carried this exact fix, with a comment, since it was written. */}
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold text-foreground">{peerName}</h3>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <div
                className={`h-2 w-2 rounded-full ${statusDisplay.color || ''}`}
                style={statusDisplay.customColor ? { backgroundColor: statusDisplay.customColor } : undefined}
              />
              <span className={statusDisplay.textColor}>{statusDisplay.text}</span>
              {(isConnected || supervisor === 'healing') && !paused && <ConnectionPathLabel route={connectionRoute} supervisor={supervisor} />}
              {/* Permanently mounted so the region pre-exists its text; a live
                  region created together with its content is announced
                  inconsistently or not at all. The pulse was purely visual. */}
              <span role="status" aria-live="polite" className="ml-2 text-primary-accent">
                {peerTyping ? <span className="animate-pulse">typing...</span> : null}
              </span>
            </div>
          </div>
        </div>
        {/* One group, so justify-between has exactly TWO children to separate:
            identity on the left, actions on the right. With the call buttons as
            a third sibling they were distributed to the MIDDLE of the header —
            visibly wrong, and it grew worse as the peer name got shorter.
            shrink-0 keeps the actions intact when a long name runs out of room. */}
        <div className="flex shrink-0 items-center gap-1">
          {call && (
            <CallEntryButtons
              targetName={peerName}
              canCall={call.canCall}
              inCall={call.inCall}
              capability={call.capability}
              onStartCall={call.onStartCall}
              onLeave={call.onLeave}
            />
          )}
          {/* Disabled with the reason rather than hidden: the storage exists once you are registered peers. */}
          <Button
            variant="ghost"
            size="icon"
            onClick={onOpenFiles ?? undefined}
            disabled={onOpenFiles === null}
            aria-label={onOpenFiles === null ? 'Shared files, available once you are registered peers' : `Files shared with ${peerName}`}
            title={onOpenFiles === null ? 'Available once you are registered peers' : 'Open the files you share'}
            className="text-muted-foreground hover:text-foreground hover:bg-surface"
            data-testid="chat-files-button"
          >
            <FolderOpen className="h-5 w-5" aria-hidden="true" />
          </Button>
          {onShare && (
            <Button variant="ghost" size="icon" onClick={onShare} aria-label={`Share the chat with ${peerName}`}
              className="text-muted-foreground hover:text-foreground hover:bg-surface" data-testid="chat-share-button">
              <Share2 className="h-5 w-5" aria-hidden="true" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={onSettingsClick}
            aria-label="Chat settings"
            className="text-muted-foreground hover:text-foreground hover:bg-surface"
            data-testid="chat-settings-button"
          >
            <Settings className="h-5 w-5" aria-hidden="true" />
          </Button>
        </div>
      </div>
    </div>
  );
}
