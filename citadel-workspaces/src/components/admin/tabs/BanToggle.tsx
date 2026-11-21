/**
 * Ban a member from the workspace, or lift their ban. A ban is workspace-wide, so the tab offers
 * this only on the workspace's own roster; the server decides whether you may (RemoveUsers, and a
 * member below you), and `blocked` says beforehand when the ladder already knows you may not.
 */
import { Ban, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { BlockedReason } from '@/components/shared/BlockedReason';
import type { MemberData } from '../types';

interface BanToggleProps {
  member: MemberData;
  blocked: string | null;
  onSetBanned: (member: MemberData, banned: boolean) => void;
}

export function BanToggle({ member, blocked, onSetBanned }: BanToggleProps): JSX.Element {
  const label: string = member.banned ? `Unban ${member.username}` : `Ban ${member.username}`;
  return (
    <BlockedReason reason={blocked}>
      <Button
        variant="ghost"
        size="icon"
        onClick={(): void => onSetBanned(member, !member.banned)}
        disabled={blocked !== null}
        title={blocked ?? label}
        aria-label={blocked ?? label}
        className="text-destructive hover:text-destructive hover:bg-destructive/15"
        data-testid={`member-${member.banned ? 'unban' : 'ban'}-${member.userId}`}
      >
        {member.banned ? <Undo2 className="h-4 w-4" /> : <Ban className="h-4 w-4" />}
      </Button>
    </BlockedReason>
  );
}
