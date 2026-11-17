/**
 * One person in the "all members" dialog: who they are, their role, and what can be done to them.
 *
 * The identity block takes the room that is left (`min-w-0`, long text breaks) and the badge and the
 * menu keep their size (`shrink-0`); with neither, a long email or username pushed the role badge and
 * the actions menu into each other or off the row.
 */
import { useState, type MouseEvent } from 'react';
import { MoreVertical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { MemberAvatar } from '@/components/shared/MemberAvatar';
import { MemberRoleBadge } from '@/components/shared/MemberRoleBadge';
import { blocksForMember } from '@/lib/member-access';
import type { User as WorkspaceMember } from '@/types/workspace-entities';
import { MemberActionItems } from './MemberActionItems';
import type { MemberActionBlocks } from './member-actions-gate';

interface AllMembersRowProps {
  member: WorkspaceMember;
  /** The reader: nothing to do to yourself, so no menu. */
  currentUsername: string | undefined;
  blocks: MemberActionBlocks;
  nameOfLevel: (levelId: string) => string;
  onManagePermissions: () => void;
  onEditMember: () => void;
  onRemoveMember: () => void;
  /** Opens the chat with this member; null for yourself. */
  onOpenChat: (() => void) | null;
  /** Opens the storage you share with this member; null for yourself. */
  onOpenFiles: (() => void) | null;
}

export function AllMembersRow({ member, currentUsername, blocks, nameOfLevel, onManagePermissions, onEditMember, onRemoveMember, onOpenChat, onOpenFiles }: AllMembersRowProps): JSX.Element {
  const hasMenu: boolean = currentUsername !== member.username;
  // Right-click opens the same menu as the ⋯ button.
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div
      className="flex items-center gap-2 p-3 rounded-lg hover:bg-card transition-colors" data-testid={`all-members-row-${member.username}`}
      onContextMenu={hasMenu ? (e: MouseEvent): void => { e.preventDefault(); setMenuOpen(true); } : undefined}
    >
      {/* A real button beside the menu, not around it: a member opens their chat here as in the
          sidebar list, and the menu's own button is never nested inside another. */}
      <button
        type="button"
        onClick={onOpenChat ?? undefined}
        disabled={onOpenChat === null}
        aria-label={onOpenChat === null ? undefined : `Message ${member.displayName || member.username}`}
        data-testid={`all-members-open-${member.username}`}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
      >
      <MemberAvatar username={member.username} name={member.displayName || member.username} className="h-8 w-8" />
      <div className="min-w-0 flex-1 break-words">
        <p className="text-foreground font-medium">{member.displayName || member.username}</p>
        {member.accessVia !== undefined && <p className="text-xs text-muted-foreground" data-testid="member-access-via">via {nameOfLevel(member.accessVia)}</p>}
        {member.username && <p className="text-sm text-muted-foreground">@{member.username}</p>}
        {member.title && <p className="text-xs text-foreground/80" data-testid="member-title">{member.title}</p>}
        {member.email && <p className="text-xs text-muted-foreground" data-testid="member-email">{member.email}</p>}
      </div>
      </button>
      <MemberRoleBadge holder={member} className="text-xs" />
      {hasMenu && (
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label={`Actions for ${member.username}`}><MoreVertical className="h-4 w-4" aria-hidden="true" /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <MemberActionItems
              blocks={blocksForMember(blocks, member.accessVia === undefined ? null : nameOfLevel(member.accessVia))}
              onOpenFiles={onOpenFiles}
              onManagePermissions={onManagePermissions}
              onEditMember={onEditMember}
              onRemoveMember={onRemoveMember}
            />
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
