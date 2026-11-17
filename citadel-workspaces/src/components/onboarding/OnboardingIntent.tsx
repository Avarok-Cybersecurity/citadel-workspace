import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Building2, KeyRound, UserPlus } from 'lucide-react';
import type { JSX } from 'react';

/**
 * The one question the product never asked, and should have.
 *
 * "Create Account" against a bare workspace address does two entirely different
 * jobs depending on who you are, and the UI has never distinguished them:
 *
 *   - the FIRST person is setting up a workspace and will be asked, after
 *     registering, for the operator's WORKSPACE_MASTER_PASSWORD in order to
 *     become the administrator (WorkspaceInitializationModal);
 *   - everyone after them is joining, and cannot possibly hold that secret.
 *
 * Today both see the same wizard, and the master password is first mentioned in
 * a modal that appears AFTER the account exists. A member who arrives before
 * anyone has initialised is shown that modal too, asking for a secret they have
 * no way to obtain -- the hazard recorded in
 * src/components/__tests__/init-modal-does-not-eject.test.ts. Naming the two
 * paths before the wizard is what removes that surprise.
 *
 * "Setting up" now opens the hosted create-workspace flow (`/create`), which
 * issues the claim code that stands in for the master password on a hosted
 * workspace, and then runs the same three wizard steps with the new address
 * filled in. "Joining" runs the wizard directly, as before.
 *
 * The answer is not merely informational, though. Answering "joining" suppresses
 * the initialization prompt for this tab — the same suppression dismissing that
 * prompt already performs — so the promise made below, that a member "should not
 * be asked for it", is kept rather than only stated. See
 * `lib/workspace-init-prompt.ts`. Answering "setting up" suppresses nothing:
 * that user has been told to have the password ready and should be prompted.
 */
export interface OnboardingIntentProps {
  open: boolean;
  /** Chosen path. `admin` has been told about the master password; `member` has not. */
  onChoose: (intent: 'admin' | 'member') => void;
  onDismiss: () => void;
}

export const OnboardingIntent = ({ open, onChoose, onDismiss }: OnboardingIntentProps): JSX.Element => (
  <Dialog open={open} onOpenChange={(next: boolean): void => { if (!next) onDismiss(); }}>
    <DialogContent className="sm:max-w-lg" data-testid="onboarding-intent">
      <DialogHeader>
        <DialogTitle>Before you create an account</DialogTitle>
        <DialogDescription>
          Which of these are you doing? It changes what you will need to hand.
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-3 pt-2">
        <button
          type="button"
          data-testid="onboarding-intent-admin"
          onClick={(): void => onChoose('admin')}
          className="text-left rounded-lg border border-border p-4 hover:border-primary-accent/60 hover:bg-card transition-colors"
        >
          <span className="flex items-center gap-2 font-medium">
            <Building2 className="w-4 h-4 shrink-0" aria-hidden="true" />
            Setting up a new workspace
          </span>
          <span className="mt-2 flex items-start gap-2 text-sm text-muted-foreground">
            <KeyRound className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
            You get a one-time claim code that makes you its owner. Running
            your own server? Use its master password instead.
          </span>
        </button>

        <button
          type="button"
          data-testid="onboarding-intent-member"
          onClick={(): void => onChoose('member')}
          className="text-left rounded-lg border border-border p-4 hover:border-primary-accent/60 hover:bg-card transition-colors"
        >
          <span className="flex items-center gap-2 font-medium">
            <UserPlus className="w-4 h-4 shrink-0" aria-hidden="true" />
            Joining a workspace someone else set up
          </span>
          <span className="mt-2 block text-sm text-muted-foreground">
            You will need its address. You do not need the master password, and
            should not be asked for it.
          </span>
        </button>
      </div>

      <div className="pt-1">
        <Button variant="ghost" size="sm" data-testid="onboarding-intent-skip" onClick={onDismiss}>
          Skip
        </Button>
      </div>
    </DialogContent>
  </Dialog>
);
