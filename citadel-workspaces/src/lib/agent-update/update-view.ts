/**
 * Which of the updater's six states to show, chosen from what the agent last said and what this
 * window is doing. Pure: the panel renders it, and nothing here asks the agent anything.
 */
import type { AgentUpdate, UpdaterSettings } from './update-state';

export type UpdateView =
  | { kind: 'checking' }
  | { kind: 'error'; message: string; update: AgentUpdate | null }
  | { kind: 'downloading'; update: AgentUpdate; progress: number }
  | { kind: 'ready'; update: AgentUpdate }
  | { kind: 'available'; update: AgentUpdate }
  | { kind: 'current'; lastChecked: bigint | null };

export interface ViewInput {
  settings: UpdaterSettings;
  update: AgentUpdate | null;
  /** A check this window asked for is in flight. */
  checking: boolean;
  /** This window's own failure to ask (the agent did not answer), in words. */
  error: string | null;
}

export function deriveUpdateView({ settings, update, checking, error }: ViewInput): UpdateView {
  if (checking) return { kind: 'checking' };
  const message: string | null = error ?? settings.lastError;
  if (message !== null) return { kind: 'error', message, update };
  if (update === null) return { kind: 'current', lastChecked: settings.lastChecked };
  if (update.ready) return { kind: 'ready', update };
  return settings.downloadProgress === undefined
    ? { kind: 'available', update }
    : { kind: 'downloading', update, progress: settings.downloadProgress };
}
