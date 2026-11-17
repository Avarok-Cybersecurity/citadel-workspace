/**
 * The port through which encryption at rest reaches the store of an account's encryption root
 * (the agent-held key). The app provides it once at boot (main.tsx), loading the agent's store
 * (agent-root-store.ts) only when a root is first needed; nothing under the device-records seam
 * imports that store, so a page without the agent (the Docs harness) never loads the connection
 * layer. Without a provided store no root can be had: records read as locked and turning
 * encryption on is refused.
 */
export interface AtRestRootStore {
  /** The account's root; null when none was ever made. Rejects when the agent did not answer. */
  read(account: bigint): Promise<Uint8Array | null>;
  write(account: bigint, root: Uint8Array): Promise<void>;
  remove(account: bigint): Promise<void>;
}

export type LoadAtRestRootStore = () => Promise<AtRestRootStore>;

let provided: LoadAtRestRootStore | null = null;

export function provideAtRestRootStore(load: LoadAtRestRootStore): void {
  provided = load;
}

/** The provided store; rejects when none was provided. */
export async function atRestRootStore(): Promise<AtRestRootStore> {
  if (provided === null) throw new Error('no store for the agent-held key was provided (lib/at-rest/root-store-port.ts)');
  return provided();
}
