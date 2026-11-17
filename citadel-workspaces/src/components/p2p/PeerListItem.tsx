import React from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { UserPlus, UserCheck, Loader2, Clock } from 'lucide-react';
import type { PendingPeerRequest } from '@/lib/peer-registration-store';
import type { Peer } from './usePeerDiscovery';
import { peerDisplayName, peerHandleName, isUnnamedPeer } from '@/lib/peer-display';
import { MemberAvatar } from '@/components/shared/MemberAvatar';

interface PeerListItemProps {
  peer: Peer;
  isRegistered: boolean;
  isOutgoing: boolean;
  incomingRequest: PendingPeerRequest | undefined;
  acceptingPeerCid: string | null;
  onAccept: (request: PendingPeerRequest) => void;
  onRegister: (peerCid: string, peerUsername: string) => void;
}

export const PeerListItem: React.FC<PeerListItemProps> = ({
  peer,
  isRegistered,
  isOutgoing,
  incomingRequest,
  acceptingPeerCid,
  onAccept,
  onRegister,
}) => {
  return (
    <div
      className="flex items-center justify-between p-3 rounded-lg bg-card hover:bg-surface transition-colors"
      data-testid="peer-row"
      data-peer-username={peerHandleName(peer)}
    >
      <div className="flex items-center space-x-3">
        <MemberAvatar username={peerHandleName(peer)} name={peerDisplayName(peer)} className="h-10 w-10 text-sm" />
        <div>
          <p className="font-medium">{peerDisplayName(peer)}</p>
          {peer.fullName && peer.username && (
            <p className="text-xs text-muted-foreground">{peer.username}</p>
          )}
          {isUnnamedPeer(peer) && (
            <p className="text-xs text-muted-foreground">Name not shared yet</p>
          )}
        </div>
      </div>
      <div className="flex items-center space-x-2">
        {peer.is_online && (
          <Badge className="bg-success/20 text-success-emphasis border-success/50">
            <div className="w-2 h-2 bg-success rounded-full mr-1 animate-pulse" />
            Online
          </Badge>
        )}
        {isRegistered ? (
          // "Contact", not "Connected": this is registration, which holds while the
          // person is offline; presence is the Online badge beside it.
          <Badge className="bg-primary-accent/20 text-primary-accent border-primary-accent/50" data-testid="peer-contact-badge">
            <UserCheck className="h-3 w-3 mr-1" />
            Contact
          </Badge>
        ) : isOutgoing ? (
          <Button
            variant="outline"
            size="sm"
            disabled
            className="border-warning/50 text-warning-emphasis cursor-not-allowed"
            data-testid="peer-awaiting"
          >
            <Clock className="h-3 w-3 mr-1 animate-pulse" />
            Awaiting Response...
          </Button>
        ) : incomingRequest ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => onAccept(incomingRequest)}
            disabled={acceptingPeerCid === peer.cid}
            data-testid="peer-accept"
            // hover:bg-success, not hover:bg-success/90. The `/90` hover is
            // borrowed from the solid primary buttons, where it darkens a fill
            // that is ALREADY there. This is an outline button: nothing is
            // underneath but the page, so at 90% the fill composited towards
            // white and the white hover label fell to 3.99:1 in light mode.
            // --success-foreground is defined against solid --success: 4.74:1.
            className="border-success text-success-emphasis hover:bg-success hover:text-success-foreground"
          >
            {acceptingPeerCid === peer.cid ? (
              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
            ) : (
              <UserPlus className="h-3 w-3 mr-1" />
            )}
            Accept Request
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={() => onRegister(peer.cid, peer.username)}
            data-testid="peer-connect"
            className="border-primary-accent text-primary-accent hover:bg-primary/90 hover:text-primary-foreground"
          >
            <UserPlus className="h-3 w-3 mr-1" />
            Connect
          </Button>
        )}
      </div>
    </div>
  );
};
