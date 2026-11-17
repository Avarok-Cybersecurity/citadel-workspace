/**
 * What `usePermission` answers, and why three of the four fields exist.
 *
 * Split from the hook for the length cap. The comments are the point: each of
 * `unanswered`, `answered` and `reason` was added after a surface rendered a
 * denial for something that was not one.
 */

export interface UsePermissionResult {
  /** Whether the user has the permission */
  allowed: boolean;
  /** Whether permissions are being loaded */
  loading: boolean;
  /** Reason for denial (for tooltip) */
  reason: string | null;
  /**
   * `true` when the retry budget ran out without an answer, so `allowed` is
   * false for want of a reply rather than because the answer was no.
   *
   * Exposed as a value because the first consumer reconstructed it by testing
   * `reason.startsWith('Your permissions here could not be checked')` — a
   * component matching on a sentence it does not own. Reword the sentence and
   * that check goes quietly false forever, and the surface it guards goes back
   * to telling a workspace owner that an admin set their theme.
   */
  unanswered: boolean;
  /**
   * `false` when no answer for this domain has been stored at all.
   *
   * `hasPermission` returns `false` for a cache MISS, which is
   * indistinguishable from a real denial at the call site. A surface that hides
   * something on `!allowed` therefore hides it for a question whose answer was
   * never recorded -- which is how the office composer disappeared for every
   * user in a three-user run. `loading` does not cover it: the fetch may not
   * have been started, or may have completed for a different domain.
   */
  answered: boolean;
  /** Force refresh the permission check */
  refresh: () => Promise<void>;
}

/**
 * Whether this answer permits the control, treating every not-a-denial as yes.
 *
 * There are four states that are not the answer "no", and each one was learned
 * from a surface that had refused a user something they were entitled to:
 *
 *   - `allowed`   — the answer was yes;
 *   - `loading`   — nobody has answered yet;
 *   - `unanswered`— the retry budget ran out, so this is a failed request;
 *   - `!answered` — no answer for this domain is stored at all, which
 *                   `hasPermission` reports as `false`, indistinguishable from
 *                   a refusal.
 *
 * Spelling that out at each call site is how they drifted: the office composer
 * had three of the four and withheld itself from every user in a three-user
 * run; the theme editor had two; `BaseOffice` had none and disabled Edit for
 * anyone whose permissions had not loaded.
 *
 * A gate that hides a control must therefore ask this, not `allowed`. Reading
 * `allowed` to DISPLAY the permission itself is a different question and stays
 * fine.
 */
export function permits(result: UsePermissionResult): boolean {
  return result.allowed || result.loading || result.unanswered || !result.answered;
}

/**
 * Whether the answer is a KNOWN yes: for a display that claims the permission, never for a gate.
 *
 * A badge or ring saying "workspace administrator" asserts something about the reader, and
 * `permits` would assert it for everyone while their answer is still on its way, or for good
 * if it never comes. What such a display shows is the answer, so it waits for one. A control
 * a person may use asks `permits`.
 */
export function confirms(result: UsePermissionResult): boolean {
  return result.allowed;
}

/** An action's enabled state and, when it is off, the reason to show. */
export interface ActionGate {
  enabled: boolean;
  reason: string | null;
}

/**
 * For an action the server refuses when the answer is no -- Edit, whose Save
 * then fails -- enabled only on a KNOWN yes.
 *
 * `permits` is right for what HIDES: an unanswered question must not read as a
 * refusal. An action offered on that basis is different: a member whose Edit
 * Content is Denied got an enabled Edit after a reload, typed, and could never
 * save. So this disables while unknown too, and says which it is: still
 * checking, could not check, or no. None of the three claims a denial it has
 * not heard.
 */
export function gateOnKnownAnswer(result: UsePermissionResult): ActionGate {
  if (result.allowed) return { enabled: true, reason: null };
  if (result.unanswered) {
    return { enabled: false, reason: result.reason ?? 'Your permissions here could not be checked. Reconnect and try again.' };
  }
  if (result.loading || !result.answered) return { enabled: false, reason: 'Checking your permissions…' };
  return { enabled: false, reason: result.reason ?? "You don't have permission to edit this content" };
}
