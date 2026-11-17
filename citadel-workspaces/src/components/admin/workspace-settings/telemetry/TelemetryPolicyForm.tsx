import { useState } from 'react';
import type { TelemetrySettings } from 'citadel-workspace-client-ts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { telemetryApi } from '@/lib/telemetry/telemetry-api';
import { describeFailure } from '@/lib/failure-message';
import { megabytesOf, policyFromForm, type PolicyResult } from './telemetry-rules';

interface TelemetryPolicyFormProps {
  settings: TelemetrySettings;
  canEdit: boolean;
  onSaved: (settings: TelemetrySettings) => void;
}

/** How long and how much each person's diagnostic logs are kept, within what the platform allows. */
export function TelemetryPolicyForm({ settings, canEdit, onSaved }: TelemetryPolicyFormProps): JSX.Element {
  const [days, setDays] = useState<string>(settings.policy.retention_days.toString());
  const [megabytes, setMegabytes] = useState<string>(megabytesOf(settings.policy.per_user_bytes));
  const [busy, setBusy] = useState<boolean>(false);
  const [problem, setProblem] = useState<string | null>(null);

  const save = async (): Promise<void> => {
    const policy: PolicyResult = policyFromForm(days, megabytes, settings);
    if (!policy.ok) { setProblem(policy.problem); return; }
    setBusy(true);
    setProblem(null);
    try {
      onSaved(await telemetryApi.setPolicy(policy.retentionDays, policy.perUserBytes));
    } catch (error: unknown) {
      setProblem(describeFailure(error, 'The limits were not saved.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2" data-testid="telemetry-policy">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="tp-days">Keep for (days, up to {settings.max_retention_days})</Label>
          <Input id="tp-days" inputMode="numeric" value={days} disabled={!canEdit || busy} onChange={(e) => setDays(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="tp-mb">Per person (MB, up to {megabytesOf(settings.max_per_user_bytes)})</Label>
          <Input id="tp-mb" inputMode="numeric" value={megabytes} disabled={!canEdit || busy} onChange={(e) => setMegabytes(e.target.value)} />
        </div>
      </div>
      {problem && <p role="alert" className="text-xs text-destructive-emphasis">{problem}</p>}
      {canEdit && <Button size="sm" onClick={(): void => { void save(); }} disabled={busy}>{busy ? 'Saving…' : 'Save limits'}</Button>}
    </div>
  );
}
