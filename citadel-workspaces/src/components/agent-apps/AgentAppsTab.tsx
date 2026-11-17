import { AppsPrivateNetworkRow } from './AppsPrivateNetworkRow';
import { useAgentAppSettings, type AgentAppSettings } from './use-agent-app-settings';

/** /agent#apps: what the signed-in member lets the apps this agent runs for them do. */
export function AgentAppsTab({ resolveCid }: { resolveCid: () => Promise<bigint | null> }): JSX.Element {
  const settings: AgentAppSettings = useAgentAppSettings(resolveCid);
  return (
    <section className="rounded-lg border p-4" data-testid="agent-apps">
      <AppsPrivateNetworkRow checked={settings.privateNetwork} signedIn={settings.cid !== null}
        onChange={settings.setPrivateNetwork} error={settings.error} />
    </section>
  );
}
