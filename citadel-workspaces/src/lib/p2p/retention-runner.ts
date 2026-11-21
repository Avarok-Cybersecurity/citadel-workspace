/**
 * What a window does about Message Retention: tell the agent a chat's period
 * changed. The agent keeps the account's one sweeper -- on hearing a period and
 * on its own timer -- so a window prunes nothing; two sweepers over one store
 * would race each other's page writes.
 *
 * Everything that touches the outside world is a dependency, so the decision
 * here is tested without the agent; retention-sweep binds the real ones.
 */
export interface RetentionDeps {
  currentCid: () => Promise<bigint | null>;
  /** Tell the agent every chat's period; it sweeps on hearing. */
  tell: (ownCid: bigint) => Promise<void>;
  /** How many messages it holds for a chat: how a change reports what went. */
  count: (peerCid: bigint) => Promise<number>;
}

export interface RetentionRunner {
  /** This chat's period was just changed; answers how many messages the agent removed. */
  retentionChanged(peerCid: bigint): Promise<number>;
}

export function createRetention(deps: RetentionDeps): RetentionRunner {
  return {
    async retentionChanged(peerCid: bigint): Promise<number> {
      const own: bigint | null = await deps.currentCid();
      if (own === null) return 0;
      const before: number = await deps.count(peerCid);
      await deps.tell(own);
      return Math.max(0, before - (await deps.count(peerCid)));
    },
  };
}
