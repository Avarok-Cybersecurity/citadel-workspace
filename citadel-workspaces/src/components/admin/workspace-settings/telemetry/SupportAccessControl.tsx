import { useState } from 'react';
import type { SupportAccess, TelemetrySettings } from 'citadel-workspace-client-ts';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { telemetryApi } from '@/lib/telemetry/telemetry-api';
import { describeFailure } from '@/lib/failure-message';
import { formatDateTime } from '@/lib/format-time';
import { SELECT_CLASS } from './select-class';
import { SUPPORT_ACCESS_DAYS, supportAccessUntil } from './telemetry-rules';

interface SupportAccessControlProps {
  access: SupportAccess;
  canEdit: boolean;
  onChanged: (settings: TelemetrySettings) => void;
}

/** Lets Avarok support read this workspace's diagnostic logs until a date the admin chooses. Off by default. */
export function SupportAccessControl({ access, canEdit, onChanged }: SupportAccessControlProps): JSX.Element {
  const [days, setDays] = useState<number>(SUPPORT_ACCESS_DAYS[0]);
  const [busy, setBusy] = useState<boolean>(false);
  const [problem, setProblem] = useState<string | null>(null);

  const apply = async (enabled: boolean): Promise<void> => {
    setBusy(true);
    setProblem(null);
    try {
      onChanged(await telemetryApi.setSupportAccess(enabled, enabled ? supportAccessUntil(days, Date.now()) : null));
    } catch (error: unknown) {
      setProblem(describeFailure(error, 'Support access was not changed.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2" data-testid="support-access">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <Label htmlFor="support-access-switch" className="text-sm font-medium">Allow Avarok support access</Label>
          <p className="text-xs text-muted-foreground">
            {access.enabled && access.until_ms !== null
              ? `Support can read the logs until ${formatDateTime(access.until_ms)}. Every read appears in the log below.`
              : 'Off. Support can read nothing unless you turn this on, and only until the date you choose.'}
          </p>
        </div>
        <Switch id="support-access-switch" checked={access.enabled} disabled={!canEdit || busy}
          onCheckedChange={(on: boolean): void => { void apply(on); }} />
      </div>
      {!access.enabled && (
        <div className="flex items-center gap-2">
          <Label htmlFor="support-access-days" className="text-xs">Access lasts</Label>
          <select id="support-access-days" className={`${SELECT_CLASS} w-auto`} value={days} disabled={!canEdit || busy}
            onChange={(e) => setDays(Number(e.target.value))}>
            {SUPPORT_ACCESS_DAYS.map((d: number) => <option key={d} value={d}>{d === 1 ? '1 day' : `${d} days`}</option>)}
          </select>
        </div>
      )}
      {problem && <p role="alert" className="text-xs text-destructive-emphasis">{problem}</p>}
    </div>
  );
}
