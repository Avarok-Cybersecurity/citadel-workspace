import { formatDateTime } from '@/lib/format-time';
import type { AgentUpdate, UpdaterSettings } from './update-state';

/** The one sentence that says which agent this is and whether it is current. */
export function versionLine(settings: UpdaterSettings, update: AgentUpdate | null): string {
  if (update) return `Citadel Agent ${settings.current}. ${update.latest} is available.`;
  const checked: string = settings.lastChecked === null
    ? 'not checked yet'
    : `last checked ${formatDateTime(Number(settings.lastChecked) * 1000)}`;
  return `Citadel Agent ${settings.current}, up to date (${checked}).`;
}
