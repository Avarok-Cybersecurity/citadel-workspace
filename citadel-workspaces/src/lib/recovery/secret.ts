/**
 * What a registration hands the person once to get back in: the 24-word recovery phrase from a
 * server that recovers accounts, or ten recovery codes from an older one. Pure.
 */

export type RecoverySecret =
  | { kind: 'phrase'; words: readonly string[] }
  /** An older server's codes: shown the same way, so they are never lost, until a phrase replaces them. */
  | { kind: 'codes'; words: readonly string[] };

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v: unknown): v is string => typeof v === 'string') : [];

/** From a RegisterSuccess's fields: the phrase when it has one, else its codes, else nothing. */
export function secretOf(success: Record<string, unknown>): RecoverySecret | null {
  const phrase: string[] = strings(success.recovery_phrase);
  if (phrase.length > 0) return { kind: 'phrase', words: phrase };
  const codes: string[] = strings(success.recovery_codes);
  return codes.length > 0 ? { kind: 'codes', words: codes } : null;
}
