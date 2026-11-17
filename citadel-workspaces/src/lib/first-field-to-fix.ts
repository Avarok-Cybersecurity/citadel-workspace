/**
 * Which field a refused submit should take the user to.
 *
 * The join form learned this first: a refusal that only announces the problem
 * moves nobody. A screen-reader user hears the message with their cursor on a
 * button, and a keyboard user shift-tabs back through the form guessing which
 * field it meant. The login form had exactly the same gap, announcing "Username
 * and password are required" while focus stayed on Sign In and no field was
 * marked invalid — the same fix, in one of the two places it belonged.
 *
 * The order is the form's own render order, so "first" means first on screen and
 * not first in whatever order the checks happen to be written.
 */
export function firstFieldToFix<Field extends string>(
  order: readonly Field[],
  values: Readonly<Record<Field, string>>,
  errors: Readonly<Partial<Record<Field, string | null>>> = {} as Partial<Record<Field, string | null>>,
): Field | null {
  for (const field of order) {
    if (!values[field]?.trim() || errors[field]) return field;
  }
  return null;
}
