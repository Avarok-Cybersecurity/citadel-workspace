/**
 * What this window knows about a newer Citadel Agent (agent 0.8.7, kernel/updates).
 *
 * The agent checks GitHub itself and tells every window, signed in or not, with
 * `UpdateAvailable`; every updater request is answered with `UpdateStatus`. This
 * module reads both into two stores the banner and the settings row show.
 *
 * Links are shown only when they point at this project's releases on GitHub: the
 * agent builds them from constants, and a window does not render one that does not.
 */
import type { UpdateAvailable, UpdateStatus } from 'citadel-internal-service-wasm-client';
import { createValueStore, type ValueStore } from '@/lib/value-store';
import { readAvailableExtras, readStatusExtras, type AvailableExtras, type StatusExtras } from './updater-extras';

export interface AgentUpdate {
  current: string;
  latest: string;
  notesUrl: string;
  downloadUrl: string;
  /** Downloaded and verified: "Restart to update" installs it. Otherwise only a link. */
  ready: boolean;
  /** Download size and release notes, when the agent says (updater-extras.ts). */
  sizeBytes?: number;
  notes?: string;
}

export const agentUpdate: ValueStore<AgentUpdate | null> = createValueStore<AgentUpdate | null>('agent-update', null);

/** Beyond the typed fields, the channel, download progress and ML-DSA verdict, when the agent says. */
export interface UpdaterSettings extends StatusExtras {
  current: string;
  autoInstall: boolean;
  /** Seconds since the epoch, as the agent reports it. */
  lastChecked: bigint | null;
  lastError: string | null;
}

export const updaterSettings: ValueStore<UpdaterSettings | null> =
  createValueStore<UpdaterSettings | null>('agent-updater-settings', null);

const RELEASES: string = 'https://github.com/Avarok-Cybersecurity/citadel-workspace/releases/';

export function isReleaseLink(url: string): boolean {
  return url.startsWith(RELEASES) && !url.includes('..');
}

/** The update an `UpdateAvailable` names, or null when its links are not this project's. */
export function fromAvailable(a: UpdateAvailable): AgentUpdate | null {
  if (!isReleaseLink(a.notes_url) || !isReleaseLink(a.download_url)) return null;
  const extras: AvailableExtras = readAvailableExtras(a);
  return { current: a.current, latest: a.latest, notesUrl: a.notes_url, downloadUrl: a.download_url, ready: a.ready, ...extras };
}

export function fromStatus(s: UpdateStatus): UpdaterSettings {
  return { current: s.current, autoInstall: s.auto_install, lastChecked: s.last_checked ?? null, lastError: s.last_error ?? null, ...readStatusExtras(s) };
}

function variant<T>(message: unknown, name: string): T | undefined {
  if (typeof message !== 'object' || message === null) return undefined;
  const root: Record<string, unknown> = message as Record<string, unknown>;
  const body: unknown = ((root.Response as Record<string, unknown> | undefined) ?? root)[name];
  return typeof body === 'object' && body !== null ? (body as T) : undefined;
}

/** Apply an inbound agent message to the stores; anything not the updater's is left alone. */
export function applyUpdaterMessage(message: unknown): void {
  const available: UpdateAvailable | undefined = variant<UpdateAvailable>(message, 'UpdateAvailable');
  if (available) {
    agentUpdate.set(fromAvailable(available));
    return;
  }
  const status: UpdateStatus | undefined = variant<UpdateStatus>(message, 'UpdateStatus');
  if (status) {
    updaterSettings.set(fromStatus(status));
    agentUpdate.set(status.available ? fromAvailable(status.available) : null);
  }
}
