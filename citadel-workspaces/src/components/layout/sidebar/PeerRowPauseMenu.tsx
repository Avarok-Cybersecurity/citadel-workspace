/**
 * A peer row's connection menu: Pause or Resume.
 *
 * Always visible, never hover-revealed -- a hover-only control does not exist
 * on a touch screen. A sibling of the row's button, not a child: a button
 * inside a button is invalid and its clicks would also open the conversation.
 */
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { MoreHorizontal } from 'lucide-react';
import { PAUSE_COPY, pauseExplanation } from '@/lib/p2p-pause/pause-copy';
import type { PauseView } from '@/components/p2p/hooks/use-peer-pause';

export interface PeerRowPause {
  status: PauseView;
  busy: boolean;
  onPause: () => void;
  onResume: () => void;
}

export function PeerRowPauseMenu({ displayName, pause }: { displayName: string; pause: PeerRowPause }): JSX.Element {
  const paused: boolean = pause.status === 'paused';
  const decided: boolean = pause.status === 'paused' || pause.status === 'active';
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Connection options for ${displayName}`}
          data-testid={`peer-row-menu-${displayName}`}
          className="tap-target absolute right-1 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:bg-surface hover:text-foreground"
        >
          <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {decided ? (
          <>
            <DropdownMenuItem disabled={pause.busy} onClick={paused ? pause.onResume : pause.onPause}>
              {paused ? PAUSE_COPY.resume : PAUSE_COPY.pause}
            </DropdownMenuItem>
            <p className="max-w-[16rem] px-2 pb-1.5 text-xs text-muted-foreground">
              {pauseExplanation(displayName, paused ? 'paused' : 'active')}
            </p>
          </>
        ) : (
          <DropdownMenuItem disabled>{pause.status === 'loading' ? 'Checking…' : PAUSE_COPY.unreadable}</DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
