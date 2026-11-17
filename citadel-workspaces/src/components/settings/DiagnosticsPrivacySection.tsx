import { useEffect, useState } from 'react';
import { Stethoscope } from 'lucide-react';
import type { CurrentTerms, MyConsent } from 'citadel-workspace-client-ts';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { TermsDialog } from '@/components/TermsDialog';
import { termsTexts } from '@/components/terms/terms-texts';
import { DIAGNOSTICS_SENT } from '@/components/JoinConsentFields';
import { useConfirm } from '@/components/shared/confirm-dialog';
import { useToast } from '@/hooks';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { telemetryApi } from '@/lib/telemetry/telemetry-api';
import { onServerConsent } from '@/lib/telemetry/consent-feed';
import { describeFailure } from '@/lib/failure-message';
import { toastSuccess } from '@/lib/toast-helpers';

const STORED_LOGS_GO: string = 'The diagnostic logs already stored for you in this workspace are deleted.';

/**
 * Diagnostic logs for the workspace this session is in: off unless the member turned them on, and
 * the member can turn them off, delete what was stored, and read the terms they accepted.
 */
export function DiagnosticsPrivacySection(): JSX.Element {
  const { toast } = useToast();
  const confirm: ReturnType<typeof useConfirm> = useConfirm();
  const workspaceName: string = useWorkspace().state.workspace?.name ?? 'this workspace';
  const [consent, setConsent] = useState<MyConsent | null>(null);
  const [terms, setTerms] = useState<CurrentTerms | null>(null);
  const [reading, setReading] = useState<boolean>(false);
  const [busy, setBusy] = useState<boolean>(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect((): (() => void) => {
    let current: boolean = true;
    Promise.all([telemetryApi.getMyConsent(), telemetryApi.getTerms()])
      .then(([mine, now]: [MyConsent, CurrentTerms]): void => { if (current) { setConsent(mine); setTerms(now); } })
      .catch((error: unknown): void => { if (current) setProblem(describeFailure(error, 'Diagnostic settings could not be read.')); });
    const unfollow: () => void = onServerConsent((mine: MyConsent): void => { if (current) setConsent(mine); });
    return (): void => { current = false; unfollow(); };
  }, []);

  const run = async (work: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setProblem(null);
    try { await work(); } catch (error: unknown) { setProblem(describeFailure(error, 'The server did not accept the change.')); } finally { setBusy(false); }
  };

  const change = (enabled: boolean): Promise<void> => run(async (): Promise<void> => {
    if (!enabled && !(await confirm({ title: 'Stop sharing diagnostic logs?', description: STORED_LOGS_GO, confirmLabel: 'Stop sharing' }))) return;
    setConsent(await telemetryApi.setConsent(enabled));
  });

  const deleteLogs = (): Promise<void> => run(async (): Promise<void> => {
    if (!(await confirm({ title: 'Delete my diagnostic logs?', description: `${STORED_LOGS_GO} This cannot be undone.`, confirmLabel: 'Delete' }))) return;
    const segments: number = await telemetryApi.deleteMine();
    toastSuccess(toast, 'Diagnostic logs deleted', segments === 0 ? 'Nothing was stored.' : undefined);
  });

  return (
    <div className="space-y-3" data-testid="diagnostics-privacy">
      <div className="flex items-center gap-2 text-sm font-medium text-foreground/80">
        <Stethoscope className="h-4 w-4 text-primary-accent" />
        Diagnostics in {workspaceName}
      </div>
      <div className="flex items-center justify-between gap-4 p-3 rounded-lg bg-background/50">
        <div className="min-w-0">
          <Label htmlFor="share-diagnostics" className="text-sm font-medium">Share diagnostic logs</Label>
          <p className="text-xs text-muted-foreground">{DIAGNOSTICS_SENT} The admins of {workspaceName} can read them. Turning this off deletes what was stored.</p>
          {consent !== null && !consent.terms_current && <p className="text-xs text-warning-emphasis mt-1">Accept the updated terms to change this.</p>}
        </div>
        <Switch id="share-diagnostics" disabled={consent === null || busy || !consent.terms_current}
          checked={consent?.telemetry_enabled ?? false} onCheckedChange={(on: boolean): void => { void change(on); }} />
      </div>
      <div className="flex items-center justify-between gap-4 p-3 rounded-lg bg-background/50">
        <div className="min-w-0">
          <p className="text-sm font-medium">Delete my diagnostic logs</p>
          <p className="text-xs text-muted-foreground">Removes everything stored for you here. It does not turn sharing off.</p>
        </div>
        <Button variant="outline" size="sm" disabled={consent === null || busy} onClick={(): void => { void deleteLogs(); }}>Delete</Button>
      </div>
      {consent !== null && (
        <p className="text-xs text-muted-foreground px-3" data-testid="accepted-terms">
          You accepted the platform terms{consent.accepted_platform_version !== null ? ` (version ${consent.accepted_platform_version})` : ''}
          {consent.accepted_workspace_version !== null ? ` and this workspace's terms (version ${consent.accepted_workspace_version})` : ''}.{' '}
          {terms !== null && <button type="button" className="underline text-primary-accent" onClick={(): void => setReading(true)}>Read the terms</button>}
        </p>
      )}
      {problem && <p role="alert" className="text-xs text-destructive-emphasis px-3">{problem}</p>}
      {reading && terms !== null && <TermsDialog documents={termsTexts(terms)} onClose={(): void => setReading(false)} />}
    </div>
  );
}
