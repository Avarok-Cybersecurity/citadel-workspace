/**
 * Runs one "Restart to update" (restart-flow.ts) over ports, so the clock, the agent and the
 * socket are injected: the live ones are in components/agent-update/use-restart-to-update.ts.
 * One per window, in a store, so the banner and the /agent page show the same restart, and the
 * outcome outlives the banner the click came from.
 */
import type { UpdateStatus } from 'citadel-internal-service-wasm-client';
import { createValueStore, type ValueStore } from '@/lib/value-store';
import { describeFailure } from '@/lib/failure-message';
import { CONNECTION_LOST, REQUEST_TIMED_OUT } from '@/lib/websocket/request-response';
import { debugLog } from '@/lib/debug-config';
import { advance, beginRestart, RESTART_DEADLINE_MS, type RestartEvent, type RestartPhase } from './restart-flow';

/** What the agent last said about itself, as the window's stores hold it. */
export interface AgentNow {
  current: string | null;
  lastError: string | null;
}

export interface RestartPorts {
  now: () => number;
  /** Runs `run` after `ms`; the result cancels it. */
  after: (ms: number, run: () => void) => () => void;
  ask: (variant: 'UpdateApply' | 'UpdateGetStatus') => Promise<UpdateStatus>;
  /** Runs `run` whenever the socket to the agent opens again; the result stops it. */
  onReconnect: (run: () => void) => () => void;
  /** Runs `run` whenever the agent's reported status changes; the result stops it. */
  watchAgent: (run: (now: AgentNow) => void) => () => void;
  agentNow: () => AgentNow;
}

export const restartPhase: ValueStore<RestartPhase> = createValueStore<RestartPhase>('agent-restart', { kind: 'idle' });

let stopCurrent: (() => void) | null = null;

/** Back to nothing to show, once an outcome has been read. A restart in progress is not dropped. */
export function dismissRestart(): void {
  if (restartPhase.get().kind !== 'restarting') restartPhase.set({ kind: 'idle' });
}

/** Ask the agent to install `target` (it runs `from`) and follow it to an outcome. */
export function restartToUpdate(target: string, from: string, ports: RestartPorts): void {
  if (restartPhase.get().kind === 'restarting') return;
  const errorBefore: string | null = ports.agentNow().lastError;
  const stops: Array<() => void> = [];
  const stop = (): void => {
    stops.splice(0).forEach((s: () => void): void => s());
    stopCurrent = null;
  };
  const step = (event: RestartEvent): void => {
    const next: RestartPhase = advance(restartPhase.get(), event);
    restartPhase.set(next);
    if (next.kind !== 'restarting') stop();
  };
  stopCurrent?.();
  stopCurrent = stop;
  restartPhase.set(beginRestart(target, from, ports.now()));
  stops.push(
    ports.after(RESTART_DEADLINE_MS, (): void => {
      const now: AgentNow = ports.agentNow();
      step({ type: 'deadline', current: now.current, lastError: now.lastError === errorBefore ? null : now.lastError });
    }),
    // A restarted agent is a new socket: its status says what it now runs (watchAgent hears it).
    ports.onReconnect((): void => {
      ports.ask('UpdateGetStatus').catch((e: unknown): void => debugLog('AgentUpdate', 'no status yet after the restart', e));
    }),
    ports.watchAgent((now: AgentNow): void => { if (now.current !== null) step({ type: 'agent', current: now.current }); }),
  );
  ports.ask('UpdateApply').then(
    (status: UpdateStatus): void => step({ type: 'answered', current: status.current, lastError: status.last_error ?? null }),
    // A lost socket is how an agent that replaces itself answers, and no answer does not say the
    // install did not start: the deadline decides both. Anything else never reached an agent.
    (e: unknown): void => {
      const text: string = String(e);
      if (!text.includes(CONNECTION_LOST) && !text.includes(REQUEST_TIMED_OUT)) {
        step({ type: 'unsent', message: describeFailure(e, 'The update did not start.') });
      }
    },
  );
}
