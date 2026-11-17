/**
 * One tab of the user directory, including what it says when it has nobody.
 *
 * The list rendered zero rows and nothing else when empty, and the Online tab
 * is commonly empty — so the most likely first visit to this page showed a
 * blank panel with no explanation. The two reasons a tab can be empty need
 * different sentences, which is the whole content of this file.
 */

import { Loader2, Users } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { MemberListItem, type MemberDisplay } from './MemberListItem';

interface DirectoryTabContentProps {
  tab: 'all' | 'online';
  members: MemberDisplay[];
  /** Every member, not just this tab's — "nobody online" and "nobody at all"
   *  are different states and only this distinguishes them. */
  totalMembers: number;
  /** Members whose presence nobody has reported: the Online tab cannot call them offline. */
  presenceUnknown: number;
  /** The member list has been asked for and has not answered: nothing here is a fact yet. */
  loading: boolean;
  /** The list was asked for and did not arrive. */
  unavailable: boolean;
  onSendMessage: (userId: string) => void;
  onInvite: (userId: string) => void;
  onSelect: (userId: string) => void;
}

export function DirectoryTabContent({
  tab,
  members,
  totalMembers,
  presenceUnknown,
  loading,
  unavailable,
  onSendMessage,
  onInvite,
  onSelect,
}: DirectoryTabContentProps): JSX.Element {
  if (members.length === 0 && loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground" data-testid="directory-loading" role="status">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        Loading members…
      </div>
    );
  }
  if (members.length === 0 && unavailable) {
    return (
      <div className="divide-y divide-border" data-testid="directory-member-list">
        <EmptyState icon={Users} title="Members could not be loaded" description="The workspace did not answer. Reload the page to try again; nobody has been removed." />
      </div>
    );
  }
  if (members.length === 0) {
    return (
      <div className="divide-y divide-border" data-testid="directory-member-list">
        <EmptyState
          icon={Users}
          title={tab === 'online' ? 'Nobody is online right now' : 'No members yet'}
          description={
            tab === 'online'
              ? totalMembers > 0
                ? presenceUnknown > 0
                  ? `Nobody is shown as online. Presence isn't known yet for ${presenceUnknown} of ${totalMembers} members.`
                  : 'Everyone in this workspace is currently offline. They will appear here when they connect.'
                : 'There is nobody in this workspace yet, so nobody can be online.'
              : 'Invite someone to this workspace and they will appear here.'
          }
        />
      </div>
    );
  }

  return (
    <div className="divide-y divide-border" data-testid="directory-member-list">
      {members.map((member) => (
        <MemberListItem
          key={member.id}
          member={member}
          variant={tab}
          onSendMessage={onSendMessage}
          onInvite={onInvite}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}
