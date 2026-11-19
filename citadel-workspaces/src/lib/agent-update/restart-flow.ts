/**
 * "Restart to update", from the click to an outcome. Pure: restart-controller.ts feeds it events.
 *
 * The agent's answer to `UpdateApply` is not the outcome. An agent that replaces itself exits
 * before answering; the menu-bar app's install answers at once and finishes (or not) after.
 * So the outcome is the agent coming back as the new version, or the deadline passing without
 * it, and either one ends the wait. Before this, an answer with no error left the banner on
 * "restarting the agent…" for ever (2026-11-18, an agent on 0.11.0 whose menu-bar app never
 * took the install).
 */
import { isAtLeast } from './agent-version';

/**
 * How long a restart may take: the agent waits 60 s for the menu-bar app to take the image
 * (HANDOFF_TAKEN_WITHIN, the agent's kernel/updates_handoff.rs), and the app gives the new
 * version 60 s to answer before putting the old one back (healthyWithin, AppUpdater.swift).
 */
export const RESTART_DEADLINE_MS: number = 120_000;

export type RestartPhase =
  | { kind: 'idle' }
  | { kind: 'restarting'; target: string; from: string; deadlineAt: number }
  | { kind: 'updated'; version: string }
  | { kind: 'failed'; target: string; message: string };

export type RestartEvent =
  /** The agent answered `UpdateApply`. */
  | { type: 'answered'; current: string; lastError: string | null }
  /** The request never reached an agent that could answer it (not a lost socket). */
  | { type: 'unsent'; message: string }
  /** The agent reported its version (a status read, after it came back or not). */
  | { type: 'agent'; current: string }
  /** The deadline passed; what is known of the agent now. */
  | { type: 'deadline'; current: string | null; lastError: string | null };

export function beginRestart(target: string, from: string, now: number): RestartPhase {
  return { kind: 'restarting', target, from, deadlineAt: now + RESTART_DEADLINE_MS };
}

/** Why the deadline ended a restart, in words. */
export function notRestarted(target: string, still: string, lastError: string | null): string {
  const minutes: number = RESTART_DEADLINE_MS / 60_000;
  const base: string = `The agent did not come back as ${target} within ${minutes} minutes, so it is still ${still}.`;
  return lastError === null ? `${base} Download ${target} and open it to install it.` : `${base} ${lastError}`;
}

export function advance(phase: RestartPhase, event: RestartEvent): RestartPhase {
  if (phase.kind !== 'restarting') return phase;
  const updated = (current: string): RestartPhase | null =>
    isAtLeast(current, phase.target) ? { kind: 'updated', version: current } : null;
  switch (event.type) {
    case 'answered':
      if (event.lastError !== null) return { kind: 'failed', target: phase.target, message: event.lastError };
      return updated(event.current) ?? phase;
    case 'unsent':
      return { kind: 'failed', target: phase.target, message: event.message };
    case 'agent':
      return updated(event.current) ?? phase;
    case 'deadline':
      return (event.current !== null ? updated(event.current) : null)
        ?? { kind: 'failed', target: phase.target, message: notRestarted(phase.target, event.current ?? phase.from, event.lastError) };
  }
}
