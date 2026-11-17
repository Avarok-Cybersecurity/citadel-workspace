/**
 * How often to tell somebody their changes are not being saved.
 *
 * `revfs:persist-failed` fires per tree, per failed write. A disk that has
 * stopped accepting writes fails every one of them, so a notice raised without
 * a bound is a toast every few seconds on top of a workspace that is already in
 * trouble — and the second one tells the user nothing the first did not.
 *
 * Pure, so the rule can be read and tested without a clock or a toaster.
 */

/** Long enough that a burst of failed writes reads as one problem. */
export const PERSIST_NOTICE_COOLDOWN_MS: 60_000 = 60_000;

export interface NoticeState {
  /** When each tree was last complained about. */
  lastToldAtMs: Map<string, number>;
}

export function shouldTell(state: NoticeState, treeKey: string, nowMs: number): boolean {
  const last: number | undefined = state.lastToldAtMs.get(treeKey);
  return last === undefined || nowMs - last >= PERSIST_NOTICE_COOLDOWN_MS;
}

export function recordTold(state: NoticeState, treeKey: string, nowMs: number): void {
  state.lastToldAtMs.set(treeKey, nowMs);
}
