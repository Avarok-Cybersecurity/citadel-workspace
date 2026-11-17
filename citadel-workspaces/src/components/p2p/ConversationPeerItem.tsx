/**
 * ConversationPeerItem sub-component for P2PPeerList.
 * Renders a single peer conversation row with avatar, status, and unread badge.
 */

import { MemberAvatar } from '@/components/shared/MemberAvatar';
import { Button } from '@/components/ui/button';
import { Circle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { PeerInfo } from './P2PPeerListHelpers';
import { formatListStamp } from '@/lib/format-time';
import { formatUnreadCount } from '@/lib/format-unread';

interface ConversationPeerItemProps {
  peer: PeerInfo;
  isSelected: boolean;
  onSelect: (cid: string) => void;
}

export function ConversationPeerItem({ peer, isSelected, onSelect }: ConversationPeerItemProps): JSX.Element {
  return (
    <Button
      variant="ghost"
      className={`w-full justify-start h-auto py-2 px-3 text-left hover:bg-surface/50 ${
        isSelected ? 'bg-surface text-foreground' : 'text-foreground/80'
      }`}
      onClick={() => onSelect(peer.cid)}
    >
      <div className="flex items-center gap-3 w-full">
        <div className="relative">
          <MemberAvatar username={peer.username} name={peer.name} className="h-10 w-10" />
          <Circle
            aria-hidden="true"
            className={`absolute bottom-0 right-0 h-3 w-3 ${
              peer.isConnected ? 'fill-success text-success-emphasis' : 'fill-muted-foreground text-muted-foreground'
            }`}
          />
          {/* Colour alone would carry the meaning, which fails WCAG 1.4.1.
              Same pairing as PeerListRow, where this was already fixed. */}
          <span className="sr-only">{peer.isConnected ? 'Online' : 'Offline'}</span>
        </div>

        <div className="flex-1 text-left min-w-0">
          <div className="flex items-center justify-between">
            <span className="font-medium text-sm truncate">
              {peer.name}
            </span>
            {peer.lastMessageTime && (
              <span className="text-xs text-muted-foreground">
                {formatListStamp(peer.lastMessageTime)}
              </span>
            )}
          </div>

          {peer.lastMessage && (
            <p className="text-xs text-muted-foreground truncate">
              {peer.lastMessage}
            </p>
          )}
        </div>

        {peer.unreadCount > 0 && (
          <Badge
            variant="default"
            className="h-5 min-w-[20px] rounded-full text-xs"
          >
            {formatUnreadCount(peer.unreadCount)}
          </Badge>
        )}
      </div>
    </Button>
  );
}
