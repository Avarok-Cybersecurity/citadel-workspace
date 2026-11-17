import { deriveUpdateView, type UpdateView } from '@/lib/agent-update/update-view';
import type { Updater } from './use-updater';

/** The state the panel shows for this updater; null until the agent has told us its settings. */
export function useUpdateView(updater: Updater): UpdateView | null {
  if (updater.settings === null) return null;
  return deriveUpdateView({ settings: updater.settings, update: updater.update, checking: updater.checking, error: updater.error });
}
