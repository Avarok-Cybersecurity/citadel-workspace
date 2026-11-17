import { AutoUpdateToggle } from './AutoUpdateToggle';
import { UpdateStatusPanel } from './UpdateStatusPanel';
import { AgentSection } from './AgentSection';
import type { UpdateView } from '@/lib/agent-update/update-view';
import { useUpdateView } from './use-update-view';
import type { RestartControl } from './use-restart-to-update';
import type { Updater } from './use-updater';

/** The updater in full: its state and what to do about it, and the one setting. */
export function AgentUpdatesTab({ updater, restart }: { updater: Updater; restart: RestartControl }): JSX.Element | null {
  const view: UpdateView | null = useUpdateView(updater);
  if (updater.settings === null || view === null) return null;
  return (
    <div className="space-y-4">
      <AgentSection title="Update status">
        <UpdateStatusPanel view={view} settings={updater.settings} onCheck={updater.check} restart={restart} />
      </AgentSection>
      <AgentSection title="Automatic updates">
        <AutoUpdateToggle checked={updater.settings.autoInstall} onChange={updater.setAutoInstall}
          description="The agent looks for a verified release on its own. It installs a downloaded one as soon as no account is signed in, because restarting ends every session." />
        {updater.settingError !== null && <p role="alert" className="text-sm text-destructive-emphasis" data-testid="agent-setting-error">{updater.settingError}</p>}
      </AgentSection>
    </div>
  );
}
