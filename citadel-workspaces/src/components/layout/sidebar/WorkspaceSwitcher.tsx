import { useRef, useState } from 'react';
import { ChevronRight, Loader2 } from 'lucide-react';
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AccountManagementDialog } from "@/components/AccountManagementDialog";
import { LazyTakeoverSignIn as TakeoverSignIn } from "@/components/LazyTakeoverSignIn";
import { useSelfName } from "@/hooks/use-self-name";
import { ServerConnect } from "@/components/ServerConnect";
import { SecurityAndProfileSteps } from "@/components/SecurityAndProfileSteps";
import { useRegistrationChoices, type RegistrationChoices } from "@/components/registration-choices";
import { WorkspaceLogoMark } from "@/components/shared/WorkspaceLogoMark";
import { useWorkspaceSwitcher } from "./useWorkspaceSwitcher";
import { WorkspaceSwitcherDropdown } from "./WorkspaceSwitcherDropdown";
import type { SignInRequest } from "@/lib/sessions/sign-in-request";

interface WorkspaceSwitcherProps {
  workspaceName?: string;
}

export const WorkspaceSwitcher = ({ workspaceName }: WorkspaceSwitcherProps): JSX.Element => {
  // Set when the user chose to move a session another browser window holds, or to sign in to one the agent does not hold.
  const [signInRequest, setSignInRequest] = useState<SignInRequest | null>(null);
  // This tab's person, named as the top bar names them (the current workspace is this tab's).
  const selfName: string | undefined = useSelfName().name;
  const {
    availableWorkspaces,
    currentWorkspace,
    isOpen,
    setIsOpen,
    isAddingWorkspace,
    setIsAddingWorkspace,
    isManagingAccounts,
    setIsManagingAccounts,
    currentStep,
    workspaceLogo,
    isSwitching,
    targetWorkspaceForNewAccount,
    setTargetWorkspaceForNewAccount,
    serverAddress,
    serverPassword,
    handleWorkspaceChange,
    handleAddWorkspace,
    handleAddAccountToWorkspace,
    handleManageAccounts,
    handleNext,
    handleBack,
  } = useWorkspaceSwitcher(workspaceName, setSignInRequest);

  /**
   * The switcher button, so closing the account manager can put focus back on
   * it. Radix hands the dropdown's focus back to this button when the menu
   * closes, but the dialog opens after that and has no trigger of its own to
   * return to -- the same gap ManageAccountsButton documents on the Landing
   * page, where closing with Escape otherwise dropped focus onto `<body>`.
   */
  const triggerRef: React.RefObject<HTMLButtonElement> = useRef<HTMLButtonElement>(null);
  const choices: RegistrationChoices = useRegistrationChoices();

  /**
   * One place to end the join flow.
   *
   * Dismissing at any step must also forget which workspace "Add another
   * account" was aimed at, or the next "Join New Workspace" would silently
   * pre-fill that server. This lived in the removed <Dialog>'s onOpenChange.
   */
  const closeAddWorkspace = (): void => {
    setIsAddingWorkspace(false);
    setTargetWorkspaceForNewAccount(null);
    choices.clearProfileDraft();
  };

  return (
    <>
      <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
        <DropdownMenuTrigger asChild>
          <button
            ref={triggerRef}
            // flex-1 min-w-0, not w-full. This button has a sibling — the sidebar
            // toggle — so `w-full` resolved to 100% of the WHOLE header group
            // while the button still started after that toggle, overhanging its
            // container by exactly the toggle's width. At 375px that pushed the
            // chevron 56px into the controls on the right, painting it over
            // them. flex-1 asks for the space that is actually left.
            className="flex items-center gap-3 py-2 hover:bg-primary-accent/10 transition-colors rounded-md flex-1 min-w-0 group bg-transparent pl-3"
            // Addressable by name. Two specs looked for `workspace-switcher`
            // and `workspace-name`; neither existed, so their preferred lookup
            // spent three seconds matching nothing on every run before falling
            // back to `button:has(svg.lucide-chevron-right)` -- a shape, which
            // is what `check-controls-are-addressed-by-testid` exists to
            // discourage.
            data-testid="workspace-switcher"
            disabled={isSwitching}
          >
            <WorkspaceLogoMark logo={workspaceLogo} name={workspaceName || currentWorkspace?.workspaceName || "Workspace"} />
            <div className="flex-1 min-w-0 text-left">
              <span className="font-semibold text-foreground block truncate group-hover:text-foreground">
                {workspaceName || currentWorkspace?.workspaceName || "Select Workspace"}
              </span>
              {(selfName ?? currentWorkspace?.username) && (
                <span className="block truncate text-xs text-muted-foreground group-hover:text-muted-foreground" data-testid="workspace-switcher-user">
                  {selfName ?? currentWorkspace?.username}
                </span>
              )}
            </div>
            {isSwitching ? (
              /* Loader2 like the other 33 spinners, and a token colour: this
                 was the app's only hand-rolled border spinner, and `border-white`
                 on the sidebar's 97%-lightness light surface was invisible. */
              <Loader2 className="w-5 h-5 shrink-0 animate-spin text-foreground mr-2" aria-hidden="true" />
            ) : (
              <ChevronRight
                className={cn(
                  // shrink-0 so a long workspace name squeezes the name, which
                  // truncates, rather than this arrow, which cannot. (It is not
                  // what fixed the 375px spill — see the button's own comment.)
                  "w-5 h-5 shrink-0 text-muted-foreground group-hover:text-foreground transition-transform duration-300 mr-2",
                  isOpen && "rotate-90"
                )}
              />
            )}
          </button>
        </DropdownMenuTrigger>
        <WorkspaceSwitcherDropdown
          availableWorkspaces={availableWorkspaces}
          currentWorkspace={currentWorkspace}
          isSwitching={isSwitching}
          onWorkspaceChange={handleWorkspaceChange}
          onAddAccountToWorkspace={handleAddAccountToWorkspace}
          onAddWorkspace={handleAddWorkspace}
          onManageAccounts={handleManageAccounts}
        />
      </DropdownMenu>

      {/* Rendered directly, NOT inside a Radix <Dialog>. LandingSteps.tsx
          renders the same three components the same way, and that is the
          version that works.

          Each step is already a full-screen `fixed inset-0` overlay carrying
          its own scrim, role="dialog", focus trap and Escape handling (see
          use-dialog-overlay), so the wrapper was a second modal around a modal.
          It did not merely duplicate — it erased them. A transformed ancestor
          becomes the containing block for a `position: fixed` descendant, and
          DialogContent is `translate-x-[-50%] translate-y-[-50%]`, so `inset-0`
          resolved to that panel rather than the viewport. The panel is a grid
          whose only children are out of flow, so it measured 0px tall, and its
          `overflow-y-auto` clipped what remained.

          Measured in Chromium on the exact class-derived CSS: DialogContent
          576x0, the step's own scrim 576x32, the card 448x420 with ZERO visible
          pixels, and elementFromPoint at the screen centre returning the
          black/80 backdrop. A dimmed screen and nothing on it. */}
      {isAddingWorkspace && currentStep === "connect" && (
        <ServerConnect
          onNext={handleNext}
          onCancel={closeAddWorkspace}
          defaultServer={targetWorkspaceForNewAccount?.serverAddress}
          title={targetWorkspaceForNewAccount ?
            `Connect to ${targetWorkspaceForNewAccount.workspaceName}` :
            undefined
          }
        />
      )}
      {isAddingWorkspace && (currentStep === "security" || currentStep === "join") && (
        <SecurityAndProfileSteps
          step={currentStep}
          choices={choices}
          serverAddress={targetWorkspaceForNewAccount?.serverAddress ?? serverAddress}
          serverPassword={serverPassword}
          defaultWorkspace={targetWorkspaceForNewAccount?.workspaceName}
          onSecurityBack={handleBack}
          onSecurityChosen={() => handleNext()}
          onJoinBack={handleBack}
          onJoined={() => handleNext()}
        />
      )}

      <TakeoverSignIn request={signInRequest} onClose={() => setSignInRequest(null)} />

      <AccountManagementDialog
        isOpen={isManagingAccounts}
        onClose={() => setIsManagingAccounts(false)}
        onRestoreFocus={() => triggerRef.current?.focus()}
      />
    </>
  );
};

export default WorkspaceSwitcher;
