/**
 * The 24-word recovery phrase a registration hands the person once: the only way back in if the
 * password and every key are lost. Pure.
 */

export type RecoveryPhrase = readonly string[];

/** From a RegisterSuccess's fields: its phrase, or null when it carries none. */
export function phraseOf(success: Record<string, unknown>): RecoveryPhrase | null {
  const raw: unknown = success.recovery_phrase;
  const words: string[] = Array.isArray(raw) ? raw.filter((v: unknown): v is string => typeof v === 'string') : [];
  return words.length > 0 ? words : null;
}
