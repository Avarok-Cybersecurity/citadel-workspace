import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ActiveSession } from "@/types/session-types";
import { getWorkspaceInitials } from "@/lib/workspace-metadata-service";

interface OrphanSessionIconProps {
  session: ActiveSession;
  workspaceName: string;
  onNavigate: () => void;
  onDisconnect: () => void;
  shouldGlow?: boolean;
  unreadCount?: number;
}

export const OrphanSessionIcon = ({
  session,
  workspaceName,
  onNavigate,
  onDisconnect,
  shouldGlow = false,
  unreadCount = 0,
}: OrphanSessionIconProps): JSX.Element => {
  const initials: string = getWorkspaceInitials(workspaceName || session.username);
  const displayName: string = session.full_name || session.username;

  return (
    <div
      className="relative group flex-shrink-0"
      data-testid={`session-icon-${session.username}`}
      data-session-cid={session.cid}
    >
      {/* Session chip - compact horizontal layout */}
      <button
        onClick={onNavigate}
        className={cn(
          "flex items-center gap-2 h-8 pl-1 pr-3 rounded-full",
          "bg-card border border-border text-foreground",
          "hover:bg-primary-accent/15 hover:border-primary-accent/30 transition-all duration-200",
          "cursor-pointer",
          shouldGlow && "border-primary-accent/50 bg-primary-accent/10"
        )}
        title={`${displayName} - ${workspaceName}`}
        data-testid={`session-button-${session.username}`}
      >
        {/* Small avatar */}
        <div className={cn(
          "w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0",
          "bg-primary text-primary-foreground text-xs font-bold"
        )}>
          {initials}
        </div>

        {/* Username */}
        <span className="text-xs font-medium text-foreground/80 max-w-[100px] truncate">
          {displayName}
        </span>

        {/* Unread badge */}
        {unreadCount > 0 && (
          <span className="inline-flex items-center justify-center min-w-[16px] h-4 rounded-full bg-destructive text-destructive-foreground text-xs font-bold px-1 leading-none">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* Disconnect X - appears on hover */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDisconnect();
        }}
        className={cn(
          // The BUTTON is a real 24x24 box; the visible dot is the span inside.
          //
          // The previous version kept the button at w-4 and grew the hit area
          // with a ::before pseudo-element, and its comment said that made it
          // 24px. Measured live, it did not: the button was 14x14 and the
          // pseudo-element 19x19. Neither reaches the WCAG 2.2 target-size
          // floor, and Lighthouse -- which measures the element's own box --
          // failed it at exactly 14px. A fix whose comment names a number the
          // code never produced is worse than no fix: it reads as done.
          //
          // Explicit px rather than w-6, because the root font-size is 14px and
          // every rem-based Tailwind size lands smaller than its name: w-4 is
          // 14px here, and w-6 would be 21px -- still under the floor.
          "absolute -top-2 -right-2 w-[24px] h-[24px] rounded-full",
          "flex items-center justify-center",
          "reveal-on-hover",
          "cursor-pointer",
          // group/x so the whole 24px target, not only the 14px dot, drives the
          // dot's border colour on hover -- otherwise the outer ring of the
          // target reacts to the pointer while the dot does not.
          "group/x text-muted-foreground hover:text-destructive"
        )}
        // Named for THIS session. Every one of them said "Disconnect from
        // workspace", so with three workspaces open a screen-reader user heard
        // three identical destructive buttons and could drop the wrong one.
        // The same fix, with the same reasoning, is already at the tab bar's
        // close button and the member list's row actions.
        aria-label={`Disconnect from ${workspaceName} as ${displayName}`}
        title={`Disconnect from ${workspaceName}`}
        data-testid={`disconnect-button-${session.username}`}
      >
        {/* The dot the user sees. Sized and bordered; the button around it is
            the target, which is why a thumb no longer lands on the session
            button underneath and switches workspaces instead. */}
        <span
          aria-hidden="true"
          className={cn(
            "w-[14px] h-[14px] rounded-full flex items-center justify-center",
            "bg-background border border-border",
            "group-hover/x:border-destructive/50"
          )}
        >
          <X className="w-2.5 h-2.5" />
        </span>
      </button>
    </div>
  );
};
