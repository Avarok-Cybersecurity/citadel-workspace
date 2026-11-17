/**
 * The workspace's role table, as this tab last heard it: the one source pickers, badges and
 * the role editor read.
 *
 * Filled by the answer to `Roles: List` and replaced by every `RoleChanged`, whether it answers
 * this tab's own edit or is the server's broadcast of someone else's, so a rename or a revoked
 * permission reaches every open picker without a re-read.
 *
 * "Asked" is not "answered": until the table arrives the state says `loading`, never an empty
 * table, so no screen renders "no roles" for a question still in flight. A failed list is kept
 * as a failure with the server's words; nothing retries on its own.
 */
import type { RolesResponse, WorkspaceRoles } from 'citadel-workspace-client-ts';
import { eventEmitter } from '@/lib/event-emitter';
import { notifyEach } from '@/lib/notify-listeners';

export type RolesState =
  | { status: 'unknown' }
  | { status: 'loading' }
  | { status: 'loaded'; table: WorkspaceRoles }
  | { status: 'failed'; reason: string };

interface RolesEvent { answer: RolesResponse }

const UNKNOWN: RolesState = { status: 'unknown' };

let state: RolesState = UNKNOWN;
/** Bumped by a session change, so an answer to the previous session's request is dropped. */
let generation: number = 0;
const listeners: Set<() => void> = new Set();

function set(next: RolesState): void {
  state = next;
  // One screen that throws must not leave the others showing the old table.
  notifyEach(listeners, 'role table');
}

export function getRolesState(): RolesState {
  return state;
}

export function subscribeRoles(listener: () => void): () => void {
  listeners.add(listener);
  return (): void => { listeners.delete(listener); };
}

/** The table carried by a `Roles` response, whichever kind it is. */
export function tableOf(answer: RolesResponse): WorkspaceRoles {
  return 'Roles' in answer ? answer.Roles : answer.RoleChanged.roles;
}

/** A refused list in the server's words. */
function reasonOf(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'The role table could not be read.';
}

/** Ask for the table. A no-op while a request is out or once it has arrived. */
export function requestRoles(list: () => Promise<WorkspaceRoles>): void {
  if (state.status === 'loading' || state.status === 'loaded') return;
  const asked: number = generation;
  set({ status: 'loading' });
  list().then(
    (table: WorkspaceRoles): void => { if (asked === generation) set({ status: 'loaded', table }); },
    (error: unknown): void => {
      // An answer that arrived another way (a broadcast) is not undone by this request failing.
      if (asked !== generation || state.status !== 'loading') return;
      set({ status: 'failed', reason: reasonOf(error) });
    },
  );
}

/**
 * Ask for the table again, whatever this tab holds: after a reconnect or a session claim, when
 * edits made while this tab was not listening never reached it as a RoleChanged.
 *
 * A table already shown stays shown until the answer replaces it, rather than every badge going
 * back to "loading" for a table that is most likely unchanged. A refusal is kept as one, in the
 * server's words, when there is no table to show; with one shown it is reported to `stale`, so
 * a failed refresh is never mistaken for a fresh table nor wipes out a good one.
 */
export async function reloadRoles(list: () => Promise<WorkspaceRoles>, stale: (reason: string) => void): Promise<void> {
  const asked: number = generation;
  if (state.status !== 'loaded') set({ status: 'loading' });
  try {
    const table: WorkspaceRoles = await list();
    if (asked === generation) set({ status: 'loaded', table });
  } catch (error: unknown) {
    if (asked !== generation) return;
    const reason: string = reasonOf(error);
    if (state.status === 'loading') set({ status: 'failed', reason });
    else stale(reason);
  }
}

/** Forget the table: another session's is not this one's. */
export function resetRoles(): void {
  generation += 1;
  set(UNKNOWN);
}

eventEmitter.on('workspace:roles', (event: RolesEvent | undefined): void => {
  if (event?.answer) set({ status: 'loaded', table: tableOf(event.answer) });
});
eventEmitter.on('instance:cid-changed', resetRoles);
