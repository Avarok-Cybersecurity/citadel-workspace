import { Button } from '@/components/ui/button';
import {
  AlertDialog, AlertDialogAction, AlertDialogTrigger, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import type { RestartControl } from './use-restart-to-update';

/** What restarting costs, said before it happens. Sessions live in the agent's memory. */
export const RESTART_WARNING: string =
  'Restarting the agent signs out every account on this computer. Each will need to sign in again.';

/**
 * "Restart to update": says what it costs, then asks the agent to install. Shared by the banner and the
 * Updates tab, so the warning and the request have one home. Disabled while the agent restarts.
 */
export function RestartToUpdate({ version, restart }: { version: string; restart: RestartControl }): JSX.Element {
  return (
    <>
      <AlertDialog>
        {/* The trigger is what returns focus to the button when the dialog closes (APG modal pattern). */}
        <AlertDialogTrigger asChild>
          <Button size="sm" data-testid="agent-update-restart" disabled={restart.phase.kind === 'restarting'}>Restart to update</Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restart to update to {version}?</AlertDialogTitle>
            <AlertDialogDescription data-testid="agent-update-warning">{RESTART_WARNING}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction data-testid="agent-update-confirm" onClick={restart.apply}>Restart and sign out</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
