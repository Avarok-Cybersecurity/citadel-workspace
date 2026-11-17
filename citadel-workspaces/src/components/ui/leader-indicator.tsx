import React, { useEffect, useState } from 'react';
import { Wifi, WifiOff } from 'lucide-react';
import { broadcastChannelService } from '@/lib/broadcast-channel-service';
import { useEventListener } from '@/hooks';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

export const LeaderIndicator: React.FC = () => {
  const [isLeader, setIsLeader] = useState(false);
  const [tabId, setTabId] = useState('');

  // Get initial state
  useEffect(() => {
    setIsLeader(broadcastChannelService.getIsLeader());
    setTabId(broadcastChannelService.getTabId());
  }, []);

  // Listen for leader changes
  useEventListener<{ isLeader: boolean; leaderId: string }>('leader-changed', ({ isLeader: newIsLeader, leaderId }) => {
    setIsLeader(newIsLeader);
    if (newIsLeader) {
      setTabId(leaderId);
    }
  });

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-center gap-1 px-2 py-1 rounded-md bg-opacity-20">
            {isLeader ? (
              <>
                <Wifi className="h-4 w-4 text-success-emphasis" />
                <span className="text-xs text-success-emphasis font-medium">Leader</span>
              </>
            ) : (
              <>
                <WifiOff className="h-4 w-4 text-muted-foreground" />
                <span className="text-xs text-muted-foreground font-medium">Follower</span>
              </>
            )}
          </div>
        </TooltipTrigger>
        <TooltipContent>
          <div className="text-xs">
            <p className="font-medium">{isLeader ? 'This tab is the leader' : 'This tab is a follower'}</p>
            <p className="text-muted-foreground">
              {isLeader
                ? 'Managing WebSocket connection for all tabs'
                : 'Receiving updates from the leader tab'}
            </p>
            <p className="text-muted-foreground mt-1">Tab ID: {tabId.substring(0, 8)}...</p>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};