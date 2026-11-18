/**
 * "Restart to update" for a component: the window's one restart (lib/agent-update/
 * restart-controller.ts) over the live clock, agent and socket.
 */
import { useCallback, useSyncExternalStore } from 'react';
import { askUpdater } from '@/lib/agent-update/requests';
import { eventEmitter } from '@/lib/event-emitter';
import { updaterSettings, type UpdaterSettings } from '@/lib/agent-update/update-state';
import { dismissRestart, restartPhase, restartToUpdate, type AgentNow, type RestartPorts } from '@/lib/agent-update/restart-controller';
import type { RestartPhase } from '@/lib/agent-update/restart-flow';

export type { RestartPhase };

export interface RestartControl {
  phase: RestartPhase;
  /** Install `target` over `from`, the version the agent runs. */
  apply: (target: string, from: string) => void;
  /** Put an outcome away. */
  dismiss: () => void;
}

function agentNow(): AgentNow {
  const settings: UpdaterSettings | null = updaterSettings.get();
  return { current: settings !== null && settings.current !== '' ? settings.current : null, lastError: settings?.lastError ?? null };
}

const LIVE_PORTS: RestartPorts = {
  now: (): number => Date.now(),
  after: (ms: number, run: () => void): (() => void) => {
    const timer: ReturnType<typeof setTimeout> = setTimeout(run, ms);
    return (): void => clearTimeout(timer);
  },
  ask: (variant: 'UpdateApply' | 'UpdateGetStatus') => askUpdater(variant),
  onReconnect: (run: () => void): (() => void) => eventEmitter.on('on-ws-connection-success', run),
  watchAgent: (run: (now: AgentNow) => void): (() => void) => updaterSettings.subscribe((): void => run(agentNow())),
  agentNow,
};

export function useRestartToUpdate(): RestartControl {
  const phase: RestartPhase = useSyncExternalStore(restartPhase.subscribe, restartPhase.get);
  const apply: (target: string, from: string) => void = useCallback((target: string, from: string): void => {
    restartToUpdate(target, from, LIVE_PORTS);
  }, []);
  return { phase, apply, dismiss: dismissRestart };
}
