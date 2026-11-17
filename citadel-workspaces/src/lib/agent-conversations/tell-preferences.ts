/**
 * When the agent hears this account's settings (push-preferences.ts says what).
 *
 * The first push goes out when the cached conversations load, which on a reload
 * is before this connection has claimed the session; the agent refuses a request
 * from a connection not attached to the session it names. That refusal was
 * logged as an error on every reload, and the settings were not said again until
 * the user next saved them. So, like the focus report (report-focus.ts), they are
 * said again when the session is claimed, and a refusal before that claim is the
 * expected answer rather than a failure.
 */

/**
 * The agent's answer to a request naming a session this connection does not
 * carry: `REFUSED` in citadel-internal-service/src/kernel/requests/mod.rs, held
 * to it by __tests__/the-ownership-refusal-is-the-agents-wording.test.ts.
 */
export const OWNERSHIP_REFUSAL: string = 'Session unavailable to this connection';

export function isOwnershipRefusal(error: unknown): boolean {
  return error instanceof Error && error.message === OWNERSHIP_REFUSAL;
}

export interface PreferencesTellerDeps {
  hosts: () => Promise<boolean>;
  ownCid: () => Promise<bigint | null>;
  push: (ownCid: bigint) => Promise<void>;
  /** A refusal that the claim will answer: worth a debug line, not an error. */
  deferred: (ownCid: bigint) => void;
}

export interface PreferencesTeller {
  /** Something the settings depend on changed, or the conversations loaded. */
  changed: () => Promise<void>;
  /** `cid`'s session was claimed on this window's connection. */
  claimed: (cid: bigint) => Promise<void>;
}

export function createPreferencesTeller(deps: PreferencesTellerDeps): PreferencesTeller {
  let claimed: boolean = false;
  const changed = async (): Promise<void> => {
    const cid: bigint | null = await deps.ownCid();
    if (cid === null || !(await deps.hosts())) return;
    try {
      await deps.push(cid);
    } catch (error: unknown) {
      // After the claim the connection carries the session, so a refusal then is a real failure.
      if (!claimed && isOwnershipRefusal(error)) {
        deps.deferred(cid);
        return;
      }
      throw error;
    }
  };
  return {
    changed,
    claimed: async (cid: bigint): Promise<void> => {
      if ((await deps.ownCid()) !== cid) return;
      claimed = true;
      await changed();
    },
  };
}
