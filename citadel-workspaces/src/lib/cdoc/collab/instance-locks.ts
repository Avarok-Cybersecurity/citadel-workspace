/**
 * Which tab instances are open, across this browser's tabs: an instance holds a lock named for
 * it while its document is open, and the browser releases it when the tab closes or crashes. A
 * held lock means "that tab sends its own edits"; an unheld one means its edits are orphaned
 * and the next tab to open the document adopts them.
 */
export interface InstanceLocks {
  /** Resolves once `name` is held by this tab; the returned function releases it. */
  hold(name: string): Promise<() => void>;
  /** Every lock name held by any tab of this origin. */
  held(): Promise<ReadonlySet<string>>;
}

/** The Web Locks API. Its absence is an error, never "every instance is closed". */
export function browserInstanceLocks(): InstanceLocks {
  const locks: LockManager | undefined = typeof navigator === 'undefined' ? undefined : navigator.locks;
  if (!locks) throw new Error('This browser has no Web Locks API, so edits kept on this device cannot be told apart by tab');
  return {
    hold: (name: string): Promise<() => void> => new Promise<() => void>((granted: (release: () => void) => void, failed: (cause: unknown) => void): void => {
      locks.request(name, { ifAvailable: true }, (lock: Lock | null): Promise<void> | undefined => {
        if (lock === null) {
          failed(new Error(`"${name}" is already held by another tab`));
          return undefined;
        }
        return new Promise<void>((release: () => void): void => granted(release));
      }).catch(failed);
    }),
    held: async (): Promise<ReadonlySet<string>> => {
      const snapshot: LockManagerSnapshot = await locks.query();
      return new Set<string>((snapshot.held ?? []).flatMap((info: LockInfo): string[] => (info.name === undefined ? [] : [info.name])));
    },
  };
}
