/**
 * Whether a call's own surface is currently on screen.
 *
 * `CallStage` mounts only inside the conversation the call belongs to, so the
 * app cannot otherwise tell "the user is looking at their call" from "the user
 * is in a call and has navigated somewhere else". That distinction is what
 * decides whether to show the ongoing-call bar.
 *
 * A counter rather than a boolean: the stage can briefly mount twice while a
 * route transition swaps layouts, and a boolean would flip to false on the
 * unmount of the old one.
 */
import { useSyncExternalStore } from 'react';
import { notifyEach } from '@/lib/notify-listeners';

let mounted: number = 0;
const listeners: Set<() => void> = new Set<() => void>();

function emit(): void {
  notifyEach(listeners, 'call-stage-presence');
}

export function registerCallStage(): () => void {
  mounted += 1;
  emit();
  return () => {
    mounted = Math.max(0, mounted - 1);
    emit();
  };
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const isMounted: () => boolean = () => mounted > 0;

export function useCallStageVisible(): boolean {
  // Server snapshot is `false`: with no DOM there is no stage on screen.
  return useSyncExternalStore(subscribe, isMounted, () => false);
}
