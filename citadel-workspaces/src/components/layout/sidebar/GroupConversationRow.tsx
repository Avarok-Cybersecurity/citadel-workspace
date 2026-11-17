/**
 * GroupConversationRow Component
 *
 * Displays a group conversation in the sidebar with overlapping member avatars.
 * Used in the Conversations section alongside P2P direct messages.
 */

import { useMemo, useRef, useEffect, useState    , type RefObject } from 'react';
import { MemberAvatar } from '@/components/shared/MemberAvatar';
import { rosterMemberName } from '@/lib/roster-peer-name';
import { useGroupPermissions } from '@/hooks/use-group-permissions';
import { useGuardedNavigate, type GuardedNavigate } from '@/hooks/use-guarded-navigate';
import { SidebarMenuItem, SidebarMenuButton } from '@/components/ui/sidebar';
import { rowClass } from './selected-row';
import { Badge } from '@/components/ui/badge';
import { membersByRank } from '@/components/chat/members-by-rank';
import type { GroupConversation, GroupMemberWithRole } from '@/types/group';
import { formatUnreadCount } from '@/lib/format-unread';

// ============================================================================
// Types
// ============================================================================

interface GroupConversationRowProps {
  group: GroupConversation;
  /** Whether this group is currently selected */
  isActive?: boolean;
}

// ============================================================================
// Constants
// ============================================================================

/** Width of each avatar circle in pixels */
const AVATAR_SIZE: 20 = 20;

/** Overlap amount in pixels (negative margin) */
const AVATAR_OVERLAP: 8 = 8;

/** Minimum number of avatars to show (even if container is small) */
const MIN_AVATARS: 2 = 2;

/** Maximum number of avatars to show */
const MAX_AVATARS: number = 4;

// The avatar palette lives in lib/avatar-color. A private copy here was the
// only reason this file could disagree with every other avatar in the app.

// ============================================================================
// Component
// ============================================================================

export function GroupConversationRow({
  group,
  isActive = false,
}: GroupConversationRowProps): JSX.Element {
  const navigate: GuardedNavigate = useGuardedNavigate();
  const containerRef: RefObject<HTMLDivElement> = useRef<HTMLDivElement>(null);
  const [maxAvatars, setMaxAvatars] = useState(MAX_AVATARS);
  const { can } = useGroupPermissions(group);

  const sortedMembers: GroupMemberWithRole[] = useMemo(
    (): GroupMemberWithRole[] => membersByRank(group),
    [group],
  );

  // Calculate how many avatars can fit
  useEffect(() => {
    const updateMaxAvatars = (): void => {
      if (!containerRef.current) return;

      // Approximate available width for avatars (container width - padding - name space)
      const containerWidth: number = containerRef.current.offsetWidth;
      const availableForAvatars: number = Math.min(80, containerWidth * 0.35);

      // Each avatar takes AVATAR_SIZE - AVATAR_OVERLAP pixels (except the last one)
      const effectiveAvatarWidth: number = AVATAR_SIZE - AVATAR_OVERLAP;
      const count: number = Math.floor(
        (availableForAvatars - AVATAR_SIZE) / effectiveAvatarWidth + 1
      );

      setMaxAvatars(Math.max(MIN_AVATARS, Math.min(MAX_AVATARS, count)));
    };

    updateMaxAvatars();

    const resizeObserver: ResizeObserver = new ResizeObserver(updateMaxAvatars);
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    return (): void => resizeObserver.disconnect();
  }, []);

  // The sidebar row discloses the membership just as the chat header does, so
  // it answers to the same permission. Without this, a role with
  // `viewMemberList` off still saw every group's roster in the sidebar.
  const canSeeMembers: boolean = can('viewMemberList');

  // Get display avatars and overflow count
  const { displayMembers, overflowCount } = useMemo(() => {
    if (!canSeeMembers) return { displayMembers: [], overflowCount: 0 };
    if (sortedMembers.length <= maxAvatars) {
      return { displayMembers: sortedMembers, overflowCount: 0 };
    }
    return {
      displayMembers: sortedMembers.slice(0, maxAvatars),
      overflowCount: sortedMembers.length - maxAvatars,
    };
  }, [sortedMembers, maxAvatars, canSeeMembers]);

  // Handle click
  const handleClick = (): void => {
    void navigate(`/groups/${group.id}`);
  };

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        data-testid={`group-row-${group.id}`}
        onClick={handleClick}
        // Announced, not only coloured -- see PeerListRow.
        aria-current={isActive ? 'page' : undefined}
        // White belongs on a primary fill, not on the page: see selected-states-do-not-borrow-a-solid-fills-foreground.test.ts.
        className={`${rowClass(isActive)} h-9 py-1`}
      >
        <div ref={containerRef} className="flex items-center gap-2 w-full">
          {/* Overlapping Avatars */}
          <div className="flex items-center flex-shrink-0">
            {displayMembers.map((member, index) => (
              <div
                key={member.cid}
                className="relative"
                style={{
                  marginLeft: index === 0 ? 0 : -AVATAR_OVERLAP,
                  zIndex: displayMembers.length - index, // First avatar on top
                }}
                title={member.username}
              >
                <MemberAvatar username={member.username} name={rosterMemberName(member)} className="h-5 w-5 border border-surface" />
              </div>
            ))}

            {/* Overflow indicator */}
            {overflowCount > 0 && (
              <div
                className="relative rounded-full flex items-center justify-center text-xs font-medium text-foreground bg-surface border border-surface"
                style={{
                  width: AVATAR_SIZE,
                  height: AVATAR_SIZE,
                  marginLeft: -AVATAR_OVERLAP,
                  zIndex: 0,
                }}
                title={`+${overflowCount} more`}
              >
                +{overflowCount}
              </div>
            )}
          </div>

          {/* Group Name */}
          <span className="flex-1 truncate text-sm font-medium">
            {group.name}
          </span>

          {/* Unread Count Badge */}
          {group.unreadCount > 0 && (
            <Badge className="h-5 min-w-[20px] px-1.5 bg-primary text-primary-foreground text-xs">
              {formatUnreadCount(group.unreadCount)}
            </Badge>
          )}
        </div>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

export default GroupConversationRow;
