/**
 * The highest security level each of the agent's accounts can sign in at, from
 * its answer to `GetAccountInformation` (`registered_security_level`).
 *
 * The SDK refuses a Connect above the level an account registered with
 * (`SessionSecurityExceedsRegistration`). The login form offered every level,
 * so choosing Extreme on a Standard account failed at sign-in. With this, the
 * form disables the levels the account cannot use.
 *
 * Levels are compared by the SDK's byte value (`SecurityLevel::value`), the
 * ordering it enforces; `Custom(n)` is `n`.
 */
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const NAMED_LEVELS: readonly string[] = ['Standard', 'Reinforced', 'High', 'Ultra', 'Extreme'];

/** A level as the SDK serialises it (`"High"`, `{ Custom: 7 }`), as its byte value; null when it is neither. */
export function securityLevelValue(level: unknown): number | null {
  if (typeof level === 'string') {
    const index: number = NAMED_LEVELS.indexOf(level);
    return index === -1 ? null : index;
  }
  if (isRecord(level) && typeof level.Custom === 'number') return level.Custom;
  return null;
}

/** A level's byte value as a name a person reads. */
export function securityLevelName(value: number): string {
  return NAMED_LEVELS[value] ?? `custom level ${value}`;
}

/** username -> byte value of the highest level it signs in at, or null when the message is not this request's answer. */
export function readAccountLevels(message: unknown, requestId: string): ReadonlyMap<string, number> | null {
  const unwrapped: unknown = isRecord(message) && isRecord(message.Response) ? message.Response : message;
  if (!isRecord(unwrapped)) return null;
  const body: unknown = unwrapped.GetAccountInformationResponse;
  if (!isRecord(body) || body.request_id !== requestId) return null;
  const accounts: unknown = body.accounts;
  const entries: unknown[] = accounts instanceof Map ? [...accounts.values()] : isRecord(accounts) ? Object.values(accounts) : [];
  const levels: Map<string, number> = new Map<string, number>();
  for (const account of entries) {
    if (!isRecord(account) || typeof account.username !== 'string') continue;
    // An agent older than the field, or one that could not read the account, sends none: nothing is disabled.
    const value: number | null = securityLevelValue(account.registered_security_level);
    if (value !== null) levels.set(account.username, value);
  }
  return levels;
}
