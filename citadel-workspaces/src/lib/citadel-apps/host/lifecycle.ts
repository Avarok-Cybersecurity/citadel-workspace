/**
 * The lifecycle of one app instance, as the host runs it: the SDK's ONE state machine
 * (citadel-app-sdk-types lifecycle.rs), read from the generated table, never restated here.
 *
 * Created -> Initialised (app_init OK) -> Running (AppEvent init) <-> Suspended -> Closing
 * (app_close) -> Closed (settled); any state but Closed aborts to Closed. A step the table does not
 * list is refused, and the caller decides what refusing means; nothing here throws.
 */
import { CLOSING_GROUPS, LIFECYCLE_TRANSITIONS, REFUSED_CLOSED, REFUSED_CLOSING } from '../sdk/generated/AbiConstants';
import type { Group } from '../sdk/generated/Group';
import type { LifecycleState } from '../sdk/generated/LifecycleState';
import type { LifecycleStep } from '../sdk/generated/LifecycleStep';
import type { Refused } from './ports';

export type { LifecycleState, LifecycleStep };

/** Where `step` takes `state`, or null when the machine does not allow it. */
export function nextLifecycle(state: LifecycleState, step: LifecycleStep): LifecycleState | null {
  return LIFECYCLE_TRANSITIONS[state][step] ?? null;
}

const CLOSING_ALLOWED: ReadonlySet<Group> = new Set<Group>(CLOSING_GROUPS);

/** What a call to `group` answers before anything else in `state`, or null to go on. */
export function lifecycleRefusal(state: LifecycleState, group: Group): Refused | null {
  if (state === 'closed') return { unavailable: REFUSED_CLOSED };
  if (state === 'closing' && !CLOSING_ALLOWED.has(group)) return { unavailable: REFUSED_CLOSING };
  return null;
}

/** One instance's position in the machine; `step` answers false for an illegal step. */
export class Lifecycle {
  private current: LifecycleState = 'created';

  get state(): LifecycleState {
    return this.current;
  }

  /** The instance ended without a settled close: Closed from every state, and Closed stays Closed. */
  abort(): void {
    this.current = nextLifecycle(this.current, 'abort') ?? this.current;
  }

  step(step: LifecycleStep): boolean {
    const next: LifecycleState | null = nextLifecycle(this.current, step);
    if (next === null) return false;
    this.current = next;
    return true;
  }
}
