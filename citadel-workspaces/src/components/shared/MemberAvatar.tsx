/**
 * A person's circular avatar: their picture, or their initials when there is none.
 *
 * One component for every place a person is shown -- the sidebar, the full member list, the
 * messages pane -- and it takes a USERNAME, never a picture: the picture comes from
 * `useAvatarUrl`, the single source, so changing it in profile settings updates every avatar.
 */
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { getUserInitials } from '@/lib/workspace-metadata-service';
import { useAvatarUrl } from '@/hooks/use-avatar-url';
import { cn } from '@/lib/utils';

interface MemberAvatarProps {
  username: string;
  /** What the initials are drawn from; the display name, falling back to the username. */
  name: string;
  className?: string;
  /** True draws the presence dot, outside the avatar's clip so it is not cut in half. Omit for no dot. */
  online?: boolean;
}

export function MemberAvatar({ username, name, className, online }: MemberAvatarProps): JSX.Element {
  const avatarUrl: string | undefined = useAvatarUrl(username);
  const avatar: JSX.Element = (
    <Avatar className={cn('h-6 w-6 shrink-0 text-xs', className)} data-testid={`member-avatar-${username}`} data-avatar-src={avatarUrl ?? ''}>
      {/* Decorative: the name is rendered beside it, so a meaningful alt would announce the
          person twice. */}
      {avatarUrl ? <AvatarImage src={avatarUrl} alt="" /> : null}
      <AvatarFallback className="bg-primary-accent/15 text-primary-accent font-semibold">
        {getUserInitials(name)}
      </AvatarFallback>
    </Avatar>
  );
  if (!online) return avatar;
  return (
    <span className="relative inline-flex shrink-0">
      {avatar}
      <span aria-hidden="true" data-testid={`member-presence-${username}`} className="absolute bottom-0 right-0 block h-2.5 w-2.5 rounded-full bg-success ring-2 ring-card" />
    </span>
  );
}
