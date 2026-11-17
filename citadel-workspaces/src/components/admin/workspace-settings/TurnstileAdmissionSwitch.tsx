import { useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { usePermission } from '@/hooks/use-permission';
import { permits } from '@/hooks/use-permission-result';
import { Permission } from '@/lib/permissions-service/types';
import { WORKSPACE_ROOT_ID } from '@/lib/workspace-constants';
import { describeFailure } from '@/lib/failure-message';
import { ADMISSION_COPY } from '@/lib/admission/copy';
import type { AdmissionSettingPort } from '@/lib/admission/workspace-setting';

/**
 * "Require a human check (Cloudflare Turnstile) to sign in", for the workspace.
 *
 * Off unless an admin turns it on. Turning it on asks first, because members on
 * an app that predates the check cannot sign in until they update. The switch
 * shows what the server stored -- asked of it on open, and after a change the
 * value it answered with -- and stays disabled, with the reason, for anyone who
 * is not an admin, on a server without the setting, and until the server has
 * said what it holds.
 */
export function TurnstileAdmissionSwitch({ port }: { port: AdmissionSettingPort }): JSX.Element {
  const { state } = useWorkspace();
  const workspaceId: string | undefined = state.workspace?.id;
  // undefined until the server answers; null when it has no such setting.
  const [stored, setStored] = useState<boolean | null | undefined>(undefined);
  const [confirming, setConfirming] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [problem, setProblem] = useState<string | null>(null);
  // EditWorkspaceConfig is what the server asks; this was "Admin" by name, which an Owner is not.
  const admin: boolean = permits(usePermission(WORKSPACE_ROOT_ID, Permission.EditWorkspaceConfig));
  const value: boolean = stored ?? false;
  const reason: string | null = !admin ? ADMISSION_COPY.adminsOnly : stored === null ? ADMISSION_COPY.serverUnsupported : null;

  useEffect((): (() => void) => {
    let live: boolean = true;
    if (workspaceId) {
      port.read()
        .then((answer: boolean | null): void => { if (live) setStored(answer); })
        .catch((error: unknown): void => { if (live) setProblem(describeFailure(error, 'The setting could not be read.')); });
    }
    return (): void => { live = false; };
  }, [port, workspaceId]);

  const write = (required: boolean): void => {
    if (!workspaceId) return;
    setSaving(true);
    setProblem(null);
    port.write(required)
      .then((answer: boolean): void => setStored(answer))
      .catch((error: unknown): void => setProblem(describeFailure(error, 'The server did not accept the change.')))
      .finally((): void => setSaving(false));
  };

  return (
    <div className="space-y-2" data-testid="turnstile-admission-setting">
      <div className="flex items-center justify-between gap-3 p-3 bg-background rounded-lg">
        <div className="flex items-start gap-2 min-w-0">
          <ShieldCheck className="h-4 w-4 mt-0.5 shrink-0 text-primary-accent" aria-hidden="true" />
          <div className="min-w-0">
            <Label htmlFor="require-turnstile" className="text-foreground cursor-pointer">{ADMISSION_COPY.settingLabel}</Label>
            <p id="require-turnstile-hint" className="text-xs text-muted-foreground">{ADMISSION_COPY.settingHint}</p>
            {reason && <p className="text-xs text-muted-foreground mt-1" data-testid="turnstile-admission-reason">{reason}</p>}
          </div>
        </div>
        <Switch
          id="require-turnstile"
          checked={value}
          disabled={reason !== null || saving || stored === undefined}
          onCheckedChange={(next: boolean): void => { if (next) setConfirming(true); else write(false); }}
          aria-describedby="require-turnstile-hint"
          data-testid="turnstile-admission-toggle"
        />
      </div>
      {problem && <p role="alert" className="text-sm text-destructive-emphasis">{problem}</p>}
      <AlertDialog open={confirming} onOpenChange={(open: boolean) => { if (!open) setConfirming(false); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{ADMISSION_COPY.confirmTitle}</AlertDialogTitle>
            <AlertDialogDescription>{ADMISSION_COPY.confirmBody}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="turnstile-admission-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction data-testid="turnstile-admission-confirm" onClick={() => { setConfirming(false); write(true); }}>
              Require it
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
