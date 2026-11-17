/**
 * The overlapping member-avatar cluster on the group chat header.
 *
 * Extracted verbatim from GroupChatHeader so the header stays within the
 * 250-line file cap while it also hosts the call controls.
 */

import { useMemo } from 'react';
import { membersByRank } from './members-by-rank';
import type { GroupConversation, GroupMemberWithRole } from '@/types/group';
import { MemberAvatar } from '@/components/shared/MemberAvatar';
import { rosterMemberName } from '@/lib/roster-peer-name';

const MAX_VISIBLE_AVATARS: number = 5;


export function GroupMemberAvatars({ group }: { group: GroupConversation }): JSX.Element {
  const sortedMembers: GroupMemberWithRole[] = useMemo(
    (): GroupMemberWithRole[] => membersByRank(group),
    [group],
  );

  const visibleMembers: GroupMemberWithRole[] = sortedMembers.slice(0, MAX_VISIBLE_AVATARS);
  const overflowCount: number = Math.max(0, sortedMembers.length - MAX_VISIBLE_AVATARS);

  return (
    <div className="flex items-center">
      {visibleMembers.map((member, index) => (
        <div
          key={member.cid}
          className="relative"
          style={{ marginLeft: index === 0 ? 0 : -10, zIndex: visibleMembers.length - index }}
          title={member.username}
        >
          <MemberAvatar username={member.username} name={rosterMemberName(member)} className="h-8 w-8 border-2 border-background" />
        </div>
      ))}
      {overflowCount > 0 && (
        <div
          className="relative rounded-full flex items-center justify-center text-xs font-medium text-foreground bg-surface border-2 border-background"
          style={{
            width: 32,
            height: 32,
            marginLeft: -10,
            zIndex: 0,
          }}
          title={`+${overflowCount} more members`}
        >
          +{overflowCount}
        </div>
      )}
    </div>
  );
}
