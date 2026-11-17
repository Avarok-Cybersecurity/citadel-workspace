/**
 * Invitations waiting for an answer, in the sidebar.
 *
 * An invitation used to be accepted on arrival; see group-invites. This is
 * where the person now chooses. Rendered outside the Conversations block on
 * purpose: that block hides itself for an account with no peers and no groups,
 * which is exactly the account most likely to be holding its first invitation.
 */
import { useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import { SidebarGroup, SidebarGroupContent, SidebarGroupLabel } from '@/components/ui/sidebar';
import { getPendingInvites, subscribeToInvites } from '@/lib/group-conversations/group-invites';
import { acceptGroupInvite, declineGroupInvite } from '@/lib/group-conversations/respond-to-invite';
import { inviteTarget, type GroupInvitePayload } from '@/hooks/use-group-state-invite';

function InviteRow({ invite }: { invite: GroupInvitePayload }): JSX.Element {
  const label: string = inviteTarget(invite);
  return (
    <li className="rounded-md border border-border px-3 py-2 text-sm" data-testid="group-invite-row" data-group-id={invite.groupId}>
      <p className="text-foreground break-words">
        <span className="font-semibold">{invite.inviterUsername}</span> invited you to{' '}
        {invite.groupName ? <span className="font-semibold">{label}</span> : label}
      </p>
      <div className="mt-2 flex gap-2">
        <Button size="sm" className="tap-target h-7" data-testid="group-invite-accept" aria-label={`Accept invitation to ${label}`}
          onClick={() => { void acceptGroupInvite(invite); }}>
          Accept
        </Button>
        <Button size="sm" variant="outline" className="tap-target h-7" data-testid="group-invite-decline" aria-label={`Decline invitation to ${label}`}
          onClick={() => { void declineGroupInvite(invite); }}>
          Decline
        </Button>
      </div>
    </li>
  );
}

export function GroupInviteList(): JSX.Element | null {
  const invites: GroupInvitePayload[] = useSyncExternalStore(subscribeToInvites, getPendingInvites);
  if (invites.length === 0) return null;
  return (
    <SidebarGroup className="flex-shrink-0 mb-4" data-testid="group-invite-list">
      <SidebarGroupLabel className="text-primary-accent font-semibold text-xs px-0">INVITATIONS</SidebarGroupLabel>
      <SidebarGroupContent>
        <ul className="space-y-2">
          {invites.map((invite) => <InviteRow key={invite.groupId} invite={invite} />)}
        </ul>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
