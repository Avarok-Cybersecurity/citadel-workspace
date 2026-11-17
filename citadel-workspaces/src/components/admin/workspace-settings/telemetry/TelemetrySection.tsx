import { useEffect, useState } from 'react';
import type { TelemetrySettings } from 'citadel-workspace-client-ts';
import { usePermission } from '@/hooks/use-permission';
import { permits } from '@/hooks/use-permission-result';
import { Permission } from '@/contexts/PermissionsContext';
import { WORKSPACE_ROOT_ID } from '@/lib/workspace-constants';
import { telemetryApi } from '@/lib/telemetry/telemetry-api';
import { describeFailure } from '@/lib/failure-message';
import { TelemetryLogViewer } from './TelemetryLogViewer';
import { TelemetryAccessLog } from './TelemetryAccessLog';
import { TelemetryPolicyForm } from './TelemetryPolicyForm';
import { SupportAccessControl } from './SupportAccessControl';
import { WorkspaceTermsEditor } from './WorkspaceTermsEditor';

function Block({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return <div className="space-y-2"><h4 className="text-sm font-medium">{title}</h4>{children}</div>;
}

/**
 * Diagnostic logs, for the people the server lets see or configure them: reading the logs, the
 * access log and the limits need `ViewTelemetry`; changing limits, terms and support access need
 * `EditWorkspaceConfig`. Without either, nothing of this renders -- the server refuses it anyway.
 */
export function TelemetrySection(): JSX.Element | null {
  const canView: boolean = permits(usePermission(WORKSPACE_ROOT_ID, Permission.ViewTelemetry));
  const canEdit: boolean = permits(usePermission(WORKSPACE_ROOT_ID, Permission.EditWorkspaceConfig));
  const [settings, setSettings] = useState<TelemetrySettings | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [reads, setReads] = useState<number>(0);

  useEffect((): (() => void) | void => {
    if (!canView) return;
    let current: boolean = true;
    telemetryApi.getSettings()
      .then((read: TelemetrySettings): void => { if (current) setSettings(read); })
      .catch((error: unknown): void => { if (current) setProblem(describeFailure(error, 'The diagnostic settings could not be read.')); });
    return (): void => { current = false; };
  }, [canView]);

  if (!canView && !canEdit) return null;
  return (
    <section aria-labelledby="telemetry-heading" className="space-y-4" data-testid="telemetry-section">
      <div>
        <h3 id="telemetry-heading" className="text-base font-semibold">Diagnostic logs</h3>
        <p className="text-sm text-muted-foreground">Warnings and errors from members who chose to share them, with names, files and addresses removed.</p>
      </div>
      {problem && <p role="alert" className="text-sm text-destructive-emphasis">{problem}</p>}
      {canView && settings !== null && (
        <>
          <Block title="Retention and size"><TelemetryPolicyForm settings={settings} canEdit={canEdit} onSaved={setSettings} /></Block>
          <SupportAccessControl access={settings.support_access} canEdit={canEdit}
            onChanged={(next: TelemetrySettings): void => setSettings(next)} />
        </>
      )}
      <Block title="Workspace terms"><WorkspaceTermsEditor canEdit={canEdit} /></Block>
      {canView && (
        <>
          <Block title="Logs"><TelemetryLogViewer onRead={(): void => setReads((n: number) => n + 1)} /></Block>
          <Block title="Who read the logs"><TelemetryAccessLog refreshKey={reads} /></Block>
        </>
      )}
    </section>
  );
}
