/**
 * Which field the user should be taken to when a submit is refused.
 *
 * Submitting the profile step with mismatched passwords left focus on the Join
 * button. The error was announced and the field was marked invalid, and neither
 * of those moves anyone: a screen-reader user hears "the passwords you entered
 * do not match" while their cursor sits on a button, and a keyboard user has to
 * shift-tab back through the form hunting for which field it meant.
 *
 * The order is the form's own order, so "first" means first on screen, not
 * first in whatever order the checks happen to be written.
 */
import { firstFieldToFix } from '@/lib/first-field-to-fix';

/** The profile step's fields, in the order they are rendered. */
export const JOIN_FIELD_ORDER: readonly ["fullName", "username", "password", "confirmPassword"] = ['fullName', 'username', 'password', 'confirmPassword'] as const;

export type JoinField = (typeof JOIN_FIELD_ORDER)[number];

/**
 * The first field that is empty, or failing a rule — whichever comes first on
 * screen. `null` when the form is submittable.
 */
export function firstInvalidField(
  values: Record<JoinField, string>,
  errors: Record<JoinField, string | null>,
): JoinField | null {
  // The rule lives in `lib/first-field-to-fix`, because the login form needs the
  // same one. Two copies of "which field do we take them to" is how the login
  // form ended up without it.
  return firstFieldToFix(JOIN_FIELD_ORDER, values, errors);
}

/**
 * Take the user to the field to fix.
 *
 * A refused submit used to leave focus on the Join button: the error was
 * announced and the field was marked `aria-invalid`, and neither of those
 * moves anyone. A screen-reader user hears the message with their cursor on a
 * button; a keyboard user shift-tabs back through the form guessing which
 * field it meant.
 *
 * Which field is a pure decision (`firstInvalidField`); this is the one line
 * that touches the DOM.
 */
export function focusFirstInvalidField(
  formData: Record<JoinField, string>, rawErrors: Record<JoinField, string | null>,
): void {
  const field: JoinField | null = firstInvalidField(
    {
      fullName: formData.fullName,
      username: formData.username,
      password: formData.password,
      confirmPassword: formData.confirmPassword,
    },
    rawErrors,
  );
  if (!field) return;
  document.getElementById(field)?.focus();
}
