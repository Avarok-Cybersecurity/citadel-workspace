/**
 * The actions on a member: one menu, used by the sidebar rows and the
 * "View all members" dialog, which had byte-identical copies of it.
 *
 * Disabled with the reason, not hidden, as Add member is: a control that
 * vanishes tells nobody the permission exists. A disabled menu item takes no
 * pointer events, so a tooltip on it would never show; the reasons are a note
 * under the items instead, each distinct sentence once.
 */
import { FolderOpen, Shield } from 'lucide-react';
import { DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import type { MemberActionBlocks } from './member-actions-gate';

interface MemberActionItemsProps {
  blocks: MemberActionBlocks;
  /** The storage you share with them, in the file manager; null for yourself. */
  onOpenFiles: (() => void) | null;
  onManagePermissions: () => void;
  onEditMember: () => void;
  onRemoveMember: () => void;
}

export function MemberActionItems({
  blocks, onOpenFiles, onManagePermissions, onEditMember, onRemoveMember,
}: MemberActionItemsProps): JSX.Element {
  const reasons: string[] = [...new Set(
    [blocks.managePermissions, blocks.changeRole, blocks.remove].filter((r: string | null): r is string => r !== null),
  )];
  return (
    <>
      {onOpenFiles !== null && (
        <>
          <DropdownMenuItem onClick={onOpenFiles} data-testid="member-open-files">
            <FolderOpen className="h-4 w-4 mr-2" aria-hidden="true" />Open their files
          </DropdownMenuItem>
          <DropdownMenuSeparator />
        </>
      )}
      <DropdownMenuItem disabled={blocks.managePermissions !== null} onClick={onManagePermissions}>
        <Shield className="h-4 w-4 mr-2" aria-hidden="true" />Manage Permissions
      </DropdownMenuItem>
      <DropdownMenuItem disabled={blocks.changeRole !== null} onClick={onEditMember}>Change Role</DropdownMenuItem>
      <DropdownMenuItem disabled={blocks.remove !== null} onClick={onRemoveMember} className="text-destructive-emphasis">
        Remove Member
      </DropdownMenuItem>
      {reasons.length > 0 && (
        <>
          <DropdownMenuSeparator />
          <div className="max-w-[16rem] px-2 py-1.5 text-xs text-muted-foreground" data-testid="member-actions-blocked-note">
            {reasons.map((reason: string) => <p key={reason}>{reason}</p>)}
          </div>
        </>
      )}
    </>
  );
}
