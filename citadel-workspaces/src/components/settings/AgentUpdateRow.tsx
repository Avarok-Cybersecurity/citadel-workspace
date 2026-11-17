/**
 * The agent's updater settings: install automatically when nobody is signed in (on until the
 * user turns it off), and Check now. Agent-wide, not per account. Hidden when the agent has no
 * updater (before 0.8.7, or a build without one). All of it is the shared updater
 * (components/agent-update): this row only arranges it.
 */
import { AutoUpdateToggle } from '@/components/agent-update/AutoUpdateToggle';
import { CheckNowButton } from '@/components/agent-update/CheckNowButton';
import { useUpdater, type Updater } from '@/components/agent-update/use-updater';
import { versionLine } from '@/lib/agent-update/version-line';
import type { UpdaterSettings } from '@/lib/agent-update/update-state';

export function AgentUpdateRow(): JSX.Element | null {
  const updater: Updater = useUpdater();
  const settings: UpdaterSettings | null = updater.settings;
  if (updater.presence !== 'present' || settings === null) return null;
  const shown: string | null = updater.error ?? updater.settingError ?? settings.lastError;
  return (
    <div className="space-y-2 p-3 rounded-lg bg-background/50" data-testid="agent-update-settings">
      <AutoUpdateToggle checked={settings.autoInstall} onChange={updater.setAutoInstall} description={versionLine(settings, updater.update)} />
      <div className="flex items-center justify-between gap-3">
        {shown ? <p role="alert" className="text-xs text-destructive">{shown}</p> : <span />}
        <CheckNowButton checking={updater.checking} onCheck={updater.check} />
      </div>
    </div>
  );
}
