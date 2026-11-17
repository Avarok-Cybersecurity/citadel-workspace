/**
 * PeerListRow Component
 *
 * Reusable row for displaying a P2P peer with avatar, status indicator,
 * and optional unread badge.
 */

import {
  SidebarMenuItem,
  SidebarMenuButton,
} from "@/components/ui/sidebar";
import { Badge } from "@/components/ui/badge";
import { rowClass } from "./selected-row";
import { connectionPathLabel } from "@/lib/ice-servers/path-copy";
import type { PeerConnectPath } from "@/types/ice-servers";
import { PAUSE_COPY } from "@/lib/p2p-pause/pause-copy";
import { PeerRowPauseMenu, type PeerRowPause } from "./PeerRowPauseMenu";
import { MemberAvatar } from '@/components/shared/MemberAvatar';
import { formatUnreadCount } from '@/lib/format-unread';

interface PeerListRowProps {
  cid: string;
  /** The key: test id and every caller address the row by username. */
  username: string;
  /** What the row shows. */
  displayName: string;
  /**
   * True, false, or null when no poll has landed yet. Null is a real answer
   * here: this row used to write "Offline" beside every peer until the first
   * poll returned, which is an assertion about somebody who may be right there.
   */
  isOnline: boolean | null;
  /** True, false, or null when the check did not answer in time. */
  isConnected: boolean | null;
  /** How the connection travels, as the agent reported it; null when it has not. */
  connectionPath: PeerConnectPath | null;
  unreadCount?: number;
  /** Whether this is the conversation currently on screen. See active-conversation. */
  isActive?: boolean;
  onClick: () => void;
  /** Omitted where pausing is not wired up; the row then has no menu. */
  pause?: PeerRowPause;
}

export function PeerListRow({
  cid,
  username,
  displayName,
  isOnline,
  isConnected,
  connectionPath,
  unreadCount,
  isActive = false,
  onClick,
  pause,
}: PeerListRowProps): JSX.Element {
  // Paused outranks presence: the link is down because the user chose it.
  const paused: boolean = pause?.status === 'paused';
  const statusColor: "bg-success" | "bg-warning" | "bg-destructive" | "bg-muted-foreground" =
    paused
      ? 'bg-muted-foreground'
      : isConnected === true
      ? 'bg-success'
      : isOnline === true
      ? 'bg-warning'
      : isOnline === false
      ? 'bg-destructive'
      : 'bg-muted-foreground';

  const statusLabel: string = paused
    ? PAUSE_COPY.statusLabel
    : isConnected === true
    ? 'Connected'
    : isOnline === true
    ? 'Online'
    : isOnline === false
    ? 'Offline'
    : 'Presence not known yet';

  // Only a live connection has a path worth naming; a stale one would mislead.
  const pathLabel: string | null = !paused && isConnected === true ? connectionPathLabel(connectionPath) : null;

  return (
    <SidebarMenuItem key={cid}>
      <SidebarMenuButton
        onClick={onClick}
        data-peer-cid={cid}
        // Addressable by the name the caller knows. The P2P helpers verify a
        // connection by looking for the peer under a section headed "CONNECTED
        // PEERS" -- a heading this app deliberately stopped using when the
        // members list was given one noun, so the check could not pass and
        // reported every connection as having failed.
        data-testid={`peer-row-${username}`}
        // Announced, not only coloured. The status dot beside it already
        // carries a text equivalent for exactly this reason; a highlight that
        // exists only as a background is invisible to a screen reader and to
        // anyone who cannot separate these two purples.
        aria-current={isActive ? 'page' : undefined}
        className={`${rowClass(isActive)} h-8 py-1${pause ? ' pr-8' : ''}`}
      >
        <div className="flex items-center gap-2 w-full">
          {/* Avatar with status indicator */}
          <div className="relative w-6 h-6 flex-shrink-0">
            <MemberAvatar username={username} name={displayName} />
            {/* Status indicator - top-right corner */}
            <div
              className={`absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-surface ${statusColor}`}
              title={pathLabel === null ? statusLabel : `${statusLabel} · ${pathLabel}`}
              data-connection-path={isConnected === true ? connectionPath ?? undefined : undefined}
            />
            {/* Colour alone would carry the meaning, which fails WCAG 1.4.1 —
                same pairing as ParticipantTile's speaking indicator. */}
            <span className="sr-only">
              {pathLabel === null ? statusLabel : `${statusLabel}, ${pathLabel}`}
            </span>
          </div>
          <span className="min-w-0 flex-1 truncate text-sm">{displayName}</span>
          {/* Visible word too: the grey dot alone reads as "offline". */}
          {paused && <span aria-hidden="true" className="shrink-0 text-xs text-muted-foreground">{PAUSE_COPY.statusLabel}</span>}
          {/* Unread count badge */}
          {unreadCount !== undefined && unreadCount > 0 && (
            <Badge className="h-5 min-w-[20px] px-1.5 bg-primary text-primary-foreground">
              {formatUnreadCount(unreadCount)}
              <span className="sr-only"> unread messages</span>
            </Badge>
          )}
        </div>
      </SidebarMenuButton>
      {pause && <PeerRowPauseMenu displayName={displayName} pause={pause} />}
    </SidebarMenuItem>
  );
}
