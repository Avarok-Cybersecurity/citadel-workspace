/**
 * Ordering SDK security levels, for a chat's minimum.
 *
 * Values are the SDK's own (`SecurityLevel::value()` in citadel_types): the
 * level is the index of the deepest ratchet layer, so a higher value is
 * strictly more layers of encryption. An offer's level arrives off the wire in
 * serde's shape -- a variant name, or `{ Custom: n }`.
 */
import type { ChatSecurityLevel } from './chat-advanced-settings';

const NAMED_VALUES: Readonly<Record<string, number>> = {
  Standard: 0,
  Reinforced: 1,
  High: 2,
  Ultra: 3,
  Extreme: 4,
};

/** The numeric level of a wire value, or null when it is not one. */
export function levelValue(level: unknown): number | null {
  if (typeof level === 'string') return NAMED_VALUES[level] ?? null;
  if (typeof level === 'object' && level !== null && 'Custom' in level) {
    const custom: unknown = (level as { Custom: unknown }).Custom;
    return typeof custom === 'number' && Number.isInteger(custom) && custom >= 0 ? custom : null;
  }
  return null;
}

/**
 * Whether a connection offered at `offered` satisfies a chat whose minimum is
 * `minimum`.
 *
 * An unreadable level is refused, except against the default minimum: a chat
 * that asked for nothing above Standard admits every offer, which is how this
 * browser behaved before the setting existed.
 */
export function offerMeetsMinimum(offered: unknown, minimum: ChatSecurityLevel): boolean {
  const need: number = NAMED_VALUES[minimum];
  if (need === 0) return true;
  const got: number | null = levelValue(offered);
  return got !== null && got >= need;
}

export function higherLevel(a: ChatSecurityLevel, b: ChatSecurityLevel): ChatSecurityLevel {
  return NAMED_VALUES[b] > NAMED_VALUES[a] ? b : a;
}
