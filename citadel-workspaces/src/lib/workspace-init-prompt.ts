/**
 * Whether to ask this tab for the workspace master password.
 *
 * The initialization prompt asks for the operator's `WORKSPACE_MASTER_PASSWORD`,
 * which no ordinary member has any way to obtain — and it is shown to EVERY user
 * until somebody completes it, because the root workspace is seeded at boot with
 * empty metadata and only this modal ever sets `initialized: true`.
 *
 * Dismissing it used to eject the user; that is fixed, and dismissing now records
 * the fact here instead. The onboarding intent dialog asks the same question
 * EARLIER and better — "are you setting this up, or joining?" — and someone who
 * answers "joining" has told us, in as many words, that they do not hold the
 * secret. Its own copy promises them they "should not be asked for it". Honouring
 * that answer is what this module is for.
 *
 * One key, one meaning, one place. It was a bare string literal at three call
 * sites and a fourth copy inside a test's regular expression, which is three
 * chances for a rename to half-apply — the failure mode being an unsuppressible
 * prompt, or a suppression nothing ever clears.
 *
 * Scope is deliberately the TAB SESSION, matching what dismissing already did:
 * a new tab asks again. Choosing "joining" therefore grants no lasting state and
 * cannot strand a workspace — nothing actually requires initialization, since the
 * root is seeded at boot and Admin is granted at connect to the first member.
 */
import { sessionGet, sessionSet, sessionRemove } from './safe-session-storage';

/**
 * The storage key. Exported for tests that assert on storage directly; production
 * code should call the three functions below rather than pass this around.
 */
export const INIT_PROMPT_SUPPRESSED_KEY: string = 'workspace-init-modal-dismissed';

/** True when this tab has already said it does not want the prompt. */
export function initPromptSuppressed(): boolean {
  return sessionGet(INIT_PROMPT_SUPPRESSED_KEY) === 'true';
}

/**
 * Stop asking this tab for the master password.
 *
 * Two callers, and they mean the same thing: dismissing the prompt, and telling
 * the onboarding dialog you are joining a workspace someone else set up.
 *
 * Returns whether it was actually recorded. `sessionSet` swallows the throw that
 * sessionStorage raises under strict privacy settings, so it can answer false --
 * and then the member who said "I am joining" is asked for the master password
 * anyway. That is the whole failure this function exists to prevent, so its
 * caller is given the chance to say so rather than the answer being dropped here.
 */
export function suppressInitPrompt(): boolean {
  return sessionSet(INIT_PROMPT_SUPPRESSED_KEY, 'true');
}

/**
 * Ask again.
 *
 * Called once initialization actually succeeds, so that a later session in this
 * tab is not silently suppressed by a decision that has since been carried out.
 */
export function clearInitPromptSuppression(): void {
  sessionRemove(INIT_PROMPT_SUPPRESSED_KEY);
}
