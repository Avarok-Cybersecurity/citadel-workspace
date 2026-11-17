/**
 * Telling the agent what this window has in front of the user, so its native
 * notices hold back what the user is already looking at (agent 0.8.6,
 * kernel/notices): the account, and the conversation if one is open.
 *
 * Sent when it changes -- the window gains or loses focus, is hidden, or opens
 * another conversation -- and only to an agent that hosts the account.
 */
export interface FocusDeps {
  hosts: () => Promise<boolean>;
  ownCid: () => Promise<bigint | null>;
  activePeer: () => bigint | null;
  /** The window is visible and has the keyboard. */
  inFront: () => boolean;
  send: (request: Record<string, unknown>) => Promise<void>;
}

/** What changed: what is in front, or which session a connection now carries. */
export interface FocusReporter {
  changed: () => Promise<void>;
  /**
   * `cid`'s session was claimed on a connection: say it again there.
   *
   * The agent keys focus by connection and drops a report from one not attached
   * to the session, so a report sent before the claim -- or over a socket since
   * replaced -- is not what it knows, and the dedupe below kept it from being
   * said again until the next focus change. Meanwhile the agent raised a notice
   * for the conversation on screen.
   */
  claimed: (cid: bigint) => Promise<void>;
}

export function createFocusReporter(deps: FocusDeps): FocusReporter {
  let last: string | null = null;
  const changed = async (): Promise<void> => {
    if (!(await deps.hosts())) return;
    const cid: bigint | null = await deps.ownCid();
    if (cid === null) return;
    const focused: boolean = deps.inFront();
    const peer: bigint | null = focused ? deps.activePeer() : null;
    const said: string = `${cid}:${peer ?? '-'}:${focused}`;
    if (said === last) return;
    last = said;
    try {
      await deps.send({
        ConnectionManagement: {
          request_id: crypto.randomUUID(),
          management_command: { ReportFocus: { session_cid: cid, peer_cid: peer, focused } },
        },
      });
    } catch (error: unknown) {
      // Never said, so not what the agent knows: the next change says it.
      last = null;
      throw error;
    }
  };
  const claimed = async (cid: bigint): Promise<void> => {
    if ((await deps.ownCid()) !== cid) return;
    last = null;
    await changed();
  };
  return { changed, claimed };
}

/** The browser's answer to "is this window in front of the user?". */
export function windowInFront(): boolean {
  return document.visibilityState === 'visible' && document.hasFocus();
}
