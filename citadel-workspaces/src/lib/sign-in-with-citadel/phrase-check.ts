/**
 * The recovery-phrase confirmation after "Create an identity": the person types back the words at a
 * few positions, chosen at random, so a phrase that was never written down is caught before it is
 * the only way back into the identity.
 */

/** How many of the 24 words the person types back. */
export const PHRASE_CHECKS: number = 3;

/** `PHRASE_CHECKS` distinct positions in `[0, length)`, ascending. */
export function phraseChecks(length: number, randomIndex: (bound: number) => number): number[] {
  if (length < PHRASE_CHECKS) throw new Error(`a phrase of ${length} words cannot be checked at ${PHRASE_CHECKS} positions`);
  const chosen: Set<number> = new Set();
  while (chosen.size < PHRASE_CHECKS) chosen.add(randomIndex(length));
  return [...chosen].sort((a: number, b: number) => a - b);
}

/** Each answer is the word at its checked position, ignoring case and surrounding space. */
export function phraseMatches(phrase: readonly string[], checks: readonly number[], answers: readonly string[]): boolean {
  return answers.length === checks.length
    && checks.every((position: number, i: number) => answers[i].trim().toLowerCase() === phrase[position]);
}
