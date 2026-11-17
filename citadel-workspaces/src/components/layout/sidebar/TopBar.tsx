import { Menu, LogOut, ArrowLeft, Download } from "lucide-react";
import { useOwnStanding } from './use-persist-own-standing';
import { Button } from "@/components/ui/button";
import { useSidebar } from "@/components/ui/sidebar";
import { useIsMobile } from "@/hooks/use-mobile";
import { CitadelLogo } from '@/components/brand/CitadelLogo';
import { BRAND_NAME } from '@/components/brand/artwork/brand-rules.generated';
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";
import { useInstallAction } from "@/components/pwa/use-install-action";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

import NotificationCenter from "@/components/notification/NotificationCenter";
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { SettingsModal, type SettingsTab } from "@/components/SettingsModal";
import { takeLinkTarget } from "@/lib/onboarding/link-target";
import { openAppsModal } from "@/lib/citadel-apps/apps-modal-store";
import { getUserInitials } from "@/lib/workspace-metadata-service";
import { LeaderIndicator } from "@/components/ui/leader-indicator";
import { isDiagnosticsUiEnabled } from "@/lib/debug-config";
import { useSelfName, type SelfName } from "@/hooks/use-self-name";
import { useState, useEffect } from "react";
import { ExitConfirmModal } from "@/components/ExitConfirmModal";
import { ProfileModal } from "@/components/settings/ProfileModal";
import { DisconnectLoadingModal } from "@/components/LoadingModal";
import { cn } from "@/lib/utils";
import { useSessionExit } from './use-session-exit';

interface TopBarProps {
  // Optional prop for backward compatibility
  currentWorkspace?: string;
}

export const TopBar = ({ currentWorkspace }: TopBarProps): JSX.Element => {
  // Installing was only offered on the landing page, so anyone already signed
  // in had no way to it except the browser's own omnibox icon, which is easy to
  // miss and absent on some platforms. Renders nothing unless the browser has
  // actually offered a prompt and we are not already the installed copy.
  const { canInstall, installNow } = useInstallAction();
  const { toggleSidebar } = useSidebar();
  const isMobile: boolean = useIsMobile();
  const { state } = useWorkspace();
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  // A native notice's "settings" link (lib/onboarding/link-target.ts) opens them at Privacy.
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('general');
  useEffect(() => {
    if (takeLinkTarget(['settings'])) { setSettingsTab('privacy'); setShowSettingsModal(true); }
  }, []);
  const {
    showDisconnectModal, disconnectStatus, disconnectError, handleRetrySignOut,
    handleExit, handleSignOut, handleDisconnectComplete,
  } = useSessionExit();

  // Get workspace name from context or fallback to prop
  const workspaceName: string = state.workspace?.name || currentWorkspace || BRAND_NAME;

  // The same name the switcher and the chat use: see useSelfName.
  const self: SelfName = useSelfName();
  const username: string = self.username || "User";
  const name: string = self.name || username;
  const userInitials: string = getUserInitials(name);
  const avatarUrl: string | undefined = state.currentUser?.avatarUrl;


  // ManageRoles: an administrator is someone who manages people's roles. A known yes only,
  // since the ring claims it (see confirms).
  const isAdmin: boolean = useOwnStanding();


  return (
    // <header>, not a div: this is the app's banner, and it completes the
    // landmark set alongside <nav> and <main> in AppLayout. Without it a screen
    // reader has no way to jump to the workspace switcher or the user menu.
    <header className="fixed top-0 left-0 right-0 h-14 bg-background border-b border-border flex items-center justify-between pr-4 z-50">
      {/*
        min-w-0 so this group can shrink. Flex children default to
        min-width:auto, meaning they refuse to go narrower than their content —
        so a long workspace name pushed the group on the right, avatar included,
        clean off a 375px viewport. That put Profile, Settings and Sign out out
        of reach entirely on a phone.
      */}
      <div className="flex items-center min-w-0 flex-1">
        {/*
          Shown at every width, not just on mobile. The toggle was gated behind
          `isMobile` AND `md:hidden`, so on a desktop viewport there was no way to
          collapse the sidebar at all — even though useSidebar().toggleSidebar and
          the Sidebar's own collapse behaviour were already wired up. Reclaiming
          that horizontal space matters most on the wide screens where the control
          was missing.
        */}
        <Button
          variant="ghost"
          size="icon"
          // shrink-0 for the same reason the right-hand group has it: `size="icon"`
          // asks for 40x40, but a flex child yields before its siblings do, and
          // at 375px this one was squeezed to 16px wide — a 40px-tall sliver.
          // On a phone this is THE control that opens navigation, so it is the
          // last thing that should give way.
          className="shrink-0 text-foreground hover:bg-primary-accent/15 hover:text-foreground mr-4"
          onClick={toggleSidebar}
          aria-label={isMobile ? 'Toggle navigation menu' : 'Toggle sidebar'}
          title={isMobile ? 'Toggle navigation menu' : 'Toggle sidebar'}
          data-testid="sidebar-toggle"
        >
          <Menu className="h-5 w-5" />
        </Button>
        {/* The PRODUCT mark; the switcher beside it names the WORKSPACE, which an
            admin can call anything. Mark alone, at 26px (so the compact cut): the bar
            has no room for a lockup beside the switcher. Hidden below `sm` for width. */}
        <CitadelLogo variant="mark" height={26} className="mr-1 hidden shrink-0 sm:inline-flex" />
        <WorkspaceSwitcher workspaceName={workspaceName} />
      </div>
      {/* shrink-0: these controls are the way out of the app and must never be
          what gives way when space runs short. */}
      <div className="flex items-center space-x-2 flex-shrink-0">
        {/* Internal multi-tab state — hidden from end users; see isDiagnosticsUiEnabled. */}
        {isDiagnosticsUiEnabled() && <LeaderIndicator />}
        <NotificationCenter />


        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            {/* Named on the BUTTON, not left to the avatar inside it. The
                initials fallback is unmounted by Radix the moment a real
                picture loads, so a name that lives only in that fallback
                disappears exactly when the user personalises their account.
                `title` was admin-only, so non-admins had nothing at all. */}
            <Button
              variant="ghost"
              size="icon"
              className="p-0 hover:bg-primary-accent/15"
              aria-label={isAdmin ? `Account menu for ${username} (workspace administrator)` : `Account menu for ${username}`}
              title={isAdmin ? "Workspace Administrator" : undefined}
              data-testid="user-avatar-button"
            >
              <Avatar className={cn(
                "h-8 w-8",
                isAdmin && "ring-2 ring-warning ring-offset-1 ring-offset-background"
              )}>
                {/* NOT decorative. This avatar is the entire content of the
                    account-menu button, and Radix unmounts the initials
                    fallback once a real picture loads — so setting a profile
                    picture used to leave the only route to Profile, Settings
                    and Sign out announced as "button". The button also carries
                    its own aria-label, which is what survives if the image
                    fails to load at all. */}
                <AvatarImage src={avatarUrl || ""} alt="" />
                <AvatarFallback className="bg-surface text-foreground">{userInitials}</AvatarFallback>
              </Avatar>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56 bg-background text-foreground border-border shadow-xl shadow-black/40">
            <DropdownMenuLabel className="text-foreground/80 text-xs font-normal">{name}</DropdownMenuLabel>
            <DropdownMenuSeparator className="bg-border" />
            <DropdownMenuItem
              className="text-foreground cursor-pointer focus:bg-primary-accent/15 focus:text-foreground"
              onClick={() => setShowProfileModal(true)}
              data-testid="account-menu-profile"
            >
              Profile
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-foreground cursor-pointer focus:bg-primary-accent/15 focus:text-foreground"
              onClick={() => setShowSettingsModal(true)}
              data-testid="account-menu-settings"
            >
              Settings
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-foreground cursor-pointer focus:bg-primary-accent/15 focus:text-foreground"
              onClick={() => openAppsModal({ kind: 'browse' })}
              data-testid="account-menu-apps"
            >
              Apps
            </DropdownMenuItem>
            {canInstall && (
              <DropdownMenuItem
                className="text-foreground cursor-pointer gap-2 focus:bg-primary-accent/15 focus:text-foreground"
                onClick={installNow}
                data-testid="account-menu-install"
              >
                <Download className="h-4 w-4" aria-hidden="true" />
                Install app
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator className="bg-border" />
            <DropdownMenuItem
              className="text-muted-foreground cursor-pointer gap-2 focus:bg-primary-accent/15 focus:text-foreground"
              onClick={() => setShowExitConfirm(true)}
              data-testid="account-menu-exit"
            >
              <ArrowLeft className="h-4 w-4" />
              Exit to Landing
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-destructive-emphasis cursor-pointer gap-2 focus:bg-destructive/10 focus:text-destructive-emphasis"
              onClick={handleSignOut}
              data-testid="account-menu-signout"
            >
              <LogOut className="h-4 w-4" />
              Sign Out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Exit confirmation modal */}
      <ExitConfirmModal
        open={showExitConfirm}
        onOpenChange={setShowExitConfirm}
        onConfirm={() => void handleExit()}
        userName={name}
        workspaceName={workspaceName}
      />

      {/* Profile settings modal */}
      <ProfileModal
        open={showProfileModal}
        onOpenChange={setShowProfileModal}
      />

      {/* Disconnect loading modal */}
      <DisconnectLoadingModal
        open={showDisconnectModal}
        status={disconnectStatus}
        workspaceName={workspaceName}
        errorMessage={disconnectError}
        onComplete={handleDisconnectComplete}
        onCancel={handleDisconnectComplete}
        onRetry={() => void handleRetrySignOut()}
      />

      {/* Settings modal */}
      <SettingsModal
        open={showSettingsModal}
        onOpenChange={setShowSettingsModal}
        tab={settingsTab}
      />
    </header>
  );
};
