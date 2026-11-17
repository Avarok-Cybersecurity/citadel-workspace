import type { JoinFormData } from './useJoinRegistration';
import { validateFullName, validateUsername, validatePassword } from '@/lib/credential-rules';

/**
 * The profile step's field errors, as a pure function of what has been typed.
 *
 * Two lists, deliberately:
 *
 *  - `rawErrors` is what is wrong right now. The submit path reads it, because a
 *    submit must not be let through on the grounds that the user has not
 *    visited the field yet.
 *  - `fieldErrors` is what the user is shown, which is the same thing filtered
 *    by whether they have left the field or tried to submit. Telling someone
 *    their one-character username is too short while they are still typing it is
 *    noise, not help.
 *
 * The rules themselves are the SDK's, enforced server-side; checking here means
 * the user learns about the 17-character password maximum while typing rather
 * than after a round trip.
 */
export interface JoinFieldErrorsResult {
  rawErrors: { fullName: string | null; username: string | null; password: string | null; confirmPassword: string | null; };
  fieldErrors: { fullName: string | null; username: string | null; password: string | null; confirmPassword: string | null; };
}

export function joinFieldErrors(
  formData: JoinFormData,
  touched: Record<string, boolean>,
  submitAttempted: boolean,
  /**
   * Why this device cannot hold the typed username here (another server's account has it,
   * known-accounts.ts), or null. Shown at once, untouched or not: it is not a typing slip.
   */
  held: string | null,
): JoinFieldErrorsResult {
  const rawErrors: { fullName: string | null; username: string | null; password: string | null; confirmPassword: string | null; } = {
    fullName: validateFullName(formData.fullName),
    username: validateUsername(formData.username) ?? held,
    password: validatePassword(formData.password),
    confirmPassword:
      formData.confirmPassword && formData.password !== formData.confirmPassword
        ? "The passwords you entered do not match"
        : null,
  };

  const visible = (field: keyof typeof rawErrors): string | null =>
    touched[field] || submitAttempted ? rawErrors[field] : null;

  return {
    rawErrors,
    fieldErrors: {
      fullName: visible("fullName"),
      username: visible("username") ?? held,
      password: visible("password"),
      confirmPassword: visible("confirmPassword"),
    },
  };
}
