/**
 * The actions at the top of the members list.
 *
 * There was one, and it was the wrong one to have alone: "find people already
 * in this workspace". The product had no answer at all to "get somebody into
 * this workspace" — no invite link, no share surface, no copy button — so the
 * first person to set one up, wanting their teammate in, found nothing.
 *
 * Then a third: "Add member". `MemberManagementModal mode="add"` had a form, a
 * handler and a server command behind it, and no button anywhere opened it —
 * the only way to admit someone by name was a modal nothing could reach. It is
 * disabled, with the reason, when the server is known to refuse (AddUsers), not
 * hidden: a control that vanishes tells nobody that the permission exists.
 *
 * Its glyph is a person-with-check, not a second person-plus: the discovery
 * button keeps `UserPlus`, which the P2P registration specs locate it by.
 */

import { Share2, UserCheck, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { usePermission } from '@/hooks/use-permission';
import { Permission } from '@/contexts/PermissionsContext';
import { addMemberBlockedReason } from './add-member-gate';
import { BlockedReason } from '@/components/shared/BlockedReason';

interface MembersHeaderActionsProps {
  onDiscover: () => void;
  onInvite: () => void;
  onAddMember: () => void;
  /** The domain the add would name; AddUsers is asked of exactly this one. */
  domainId: string;
}

const ACTION_CLASS: "h-6 w-6 text-primary-accent hover:bg-primary-accent/15 hover:text-foreground disabled:opacity-40" =
  'h-6 w-6 text-primary-accent hover:bg-primary-accent/15 hover:text-foreground disabled:opacity-40';

const ADD_MEMBER_LABEL: string = 'Add a member by username';

export function MembersHeaderActions({
  onDiscover, onInvite, onAddMember, domainId,
}: MembersHeaderActionsProps): JSX.Element {
  const blockedReason: string | null = addMemberBlockedReason(usePermission(domainId, Permission.AddUsers));
  return (
    <div className="flex shrink-0 items-center" data-testid="members-header-actions">
      <Button
        variant="ghost"
        size="icon"
        className={ACTION_CLASS}
        onClick={onDiscover}
        data-testid="find-people-button"
        aria-label="Find people already in this workspace"
        title="Find people already in this workspace"
      >
        <UserPlus className="h-4 w-4" aria-hidden="true" />
      </Button>
      <BlockedReason reason={blockedReason}>
        <Button
          variant="ghost"
          size="icon"
          className={ACTION_CLASS}
          onClick={onAddMember}
          disabled={blockedReason !== null}
          data-testid="add-member-button"
          aria-label={blockedReason === null ? ADD_MEMBER_LABEL : `${ADD_MEMBER_LABEL} (${blockedReason})`}
          title={blockedReason ?? ADD_MEMBER_LABEL}
        >
          <UserCheck className="h-4 w-4" aria-hidden="true" />
        </Button>
      </BlockedReason>
      <Button
        variant="ghost"
        size="icon"
        className={ACTION_CLASS}
        onClick={onInvite}
        aria-label="Invite someone to this workspace"
        title="Invite someone to this workspace"
      >
        <Share2 className="h-4 w-4" aria-hidden="true" />
      </Button>
    </div>
  );
}
