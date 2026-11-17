import { MemberAvatar } from '@/components/shared/MemberAvatar';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { MessageCircle, UserPlus } from 'lucide-react';
import { formatPresence } from '@/lib/date-utils';
import { MemberRoleBadge } from '@/components/shared/MemberRoleBadge';

export interface MemberDisplay {
  id: string;
  displayName: string;
  avatarUrl?: string;
  email?: string;
  /** The legacy role mirror, shown only when `roleId` is unknown. */
  role?: string;
  roleId?: string;
  /** Null: nobody has said. See lib/presence.ts. */
  isOnline: boolean | null;
  lastActive?: number;
  /** The reader's own row: marked, and offering nothing to do to yourself. */
  isSelf: boolean;
  /** Already a registered peer: a connection request would be for a contact you have. */
  isContact: boolean;
}

interface MemberListItemProps {
  member: MemberDisplay;
  /**
   * There used to be a 'favorites' variant here, rendering an Unfavourite star
   * with no onClick. Nothing ever passed it -- the directory has two tabs -- so
   * it was an unreachable branch containing a control that did nothing, which
   * is two ways of being wrong about the same button.
   */
  variant: 'all' | 'online';
  onSendMessage: (userId: string) => void;
  onInvite: (userId: string) => void;
  /** Show this member in the profile panel. Required — see the note below. */
  onSelect: (userId: string) => void;
}

export function MemberListItem({ member, variant, onSendMessage, onInvite, onSelect }: MemberListItemProps): JSX.Element {
  // The row is selectable. It was not before, while UserProfileCard sat beside it
  // saying "Click on a user or search to view their profile" — so the panel could
  // only ever be filled from the search box, and clicking a name did nothing.
  //
  // The identity half of the row is the button; the action buttons are its
  // siblings, not its children.
  //
  // Making the whole row role="button" tabIndex={0} looked reasonable — it was
  // one clickable row — but a control with focusable descendants is the
  // nested-interactive pattern, and screen readers do not agree on how to
  // present it: the row claims to be one button while containing two more.
  // Splitting it keeps every control reachable and unambiguous, and means the
  // inner buttons no longer need stopPropagation to avoid also selecting.
  return (
    <div className="flex items-center justify-between p-4 hover:bg-card transition-colors">
      <button
        type="button"
        onClick={() => onSelect(member.id)}
        aria-label={`View profile for ${member.displayName}`}
        className="flex items-center space-x-3 flex-1 min-w-0 text-left cursor-pointer rounded focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring">
        <MemberAvatar username={member.id} name={member.displayName} className="h-10 w-10 text-sm" online={member.isOnline === true} />
        <div>
          <h3 className="font-medium text-foreground">
            {member.displayName}
            {member.isSelf && <Badge variant="outline" className="ml-2 text-xs">You</Badge>}
          </h3>
          <div className="flex items-center space-x-2">
            <MemberRoleBadge holder={member} className="text-xs" />
            <span className={`text-xs ${variant === 'online' ? 'text-success-emphasis' : 'text-muted-foreground'}`}>
              {variant === 'online'
                ? 'Online now'
                : formatPresence(member.isOnline, member.lastActive)}
            </span>
          </div>
        </div>
      </button>
      {!member.isSelf && <div className="flex space-x-2">
        {!member.isContact && (
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-foreground hover:bg-accent"
            onClick={() => onInvite(member.id)}
            aria-label={`Send a connection request to ${member.displayName}`}
          >
            <UserPlus className="h-4 w-4" aria-hidden="true" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-foreground hover:bg-accent"
          onClick={() => onSendMessage(member.id)}
          aria-label={`Message ${member.displayName}`}
        >
          <MessageCircle className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>}
    </div>
  );
}
