import { useEffect } from 'react';
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { useTermsGate, type TermsGate as Gate } from './use-terms-gate';
import { TermsSections } from '@/components/TermsDialog';
import { termsTexts } from './terms-texts';
import { DisconnectLoadingModal } from '@/components/LoadingModal';
import { useSessionExit } from '@/components/layout/sidebar/use-session-exit';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { bootConsoleCapture } from '@/lib/telemetry/console-capture/boot';

/**
 * Blocks the workspace until the member accepts terms they have not accepted yet: the platform's
 * new version, or the workspace's own. Nothing else in the workspace is reachable behind it.
 *
 * It also runs console capture while the workspace is open, so capture is following consent
 * before the gate's own consent question is answered.
 */
export function TermsGate(): JSX.Element | null {
  const gate: Gate = useTermsGate();
  useEffect((): (() => void) => bootConsoleCapture(), []);
  const exit: ReturnType<typeof useSessionExit> = useSessionExit();
  const workspaceName: string = useWorkspace().state.workspace?.name ?? 'this workspace';
  if (gate.owed === null) return null;
  return (
    <>
    {/* Closed while the sign-out narrates itself: two modals would fight for the pointer. */}
    <AlertDialog open={!exit.showDisconnectModal}>
      <AlertDialogContent className="max-h-[85vh] overflow-y-auto" data-testid="terms-gate">
        <AlertDialogHeader>
          <AlertDialogTitle>Please accept the updated terms</AlertDialogTitle>
          <AlertDialogDescription>You can keep using this workspace once you accept them, or sign out.</AlertDialogDescription>
        </AlertDialogHeader>
        <TermsSections documents={termsTexts(gate.owed)} />
        {gate.problem && <p role="alert" className="text-sm text-destructive-emphasis">{gate.problem}</p>}
        <AlertDialogFooter>
          <Button variant="outline" data-testid="terms-gate-signout" disabled={gate.accepting} onClick={(): void => { void exit.handleSignOut(); }}>
            Sign out
          </Button>
          <Button data-testid="terms-gate-accept" disabled={gate.accepting} onClick={(): void => { void gate.accept(); }}>
            {gate.accepting ? 'Saving…' : 'I accept'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    <DisconnectLoadingModal
      open={exit.showDisconnectModal}
      status={exit.disconnectStatus}
      workspaceName={workspaceName}
      errorMessage={exit.disconnectError}
      onComplete={exit.handleDisconnectComplete}
      onCancel={exit.handleDisconnectComplete}
      onRetry={(): void => { void exit.handleRetrySignOut(); }}
    />
    </>
  );
}
