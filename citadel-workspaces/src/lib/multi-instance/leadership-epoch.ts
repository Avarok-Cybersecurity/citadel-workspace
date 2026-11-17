/**
 * Fencing for leadership: every leadership has an epoch, and a follower never goes back to an
 * older one.
 *
 * A leader that was frozen (a background tab the browser suspended, a laptop lid) can wake
 * still believing it leads and heartbeat as if nothing happened. Without a fence its followers
 * took it back as leader and sent it their requests, though another tab had been elected in
 * the meantime. With one, a heartbeat whose epoch is lower than the one a follower already
 * follows is ignored; an equal one is the same leadership and passes.
 *
 * The counter lives in localStorage, which every tab of the origin shares, so a newly elected
 * leader takes a number above every leadership before it. Where storage is refused the tab
 * still counts above the highest epoch it has seen, which is what its followers compare.
 */
const EPOCH_KEY: string = 'citadel-leader-epoch';

let followed: number = 0;
let own: number = 0;

function storedEpoch(): number {
  try {
    const raw: string | null = localStorage.getItem(EPOCH_KEY);
    const value: number = raw === null ? 0 : Number(raw);
    return Number.isSafeInteger(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
}

function store(epoch: number): void {
  try {
    localStorage.setItem(EPOCH_KEY, String(epoch));
  } catch {
    // Storage refused: this tab's own count still rises above everything it has seen.
  }
}

/** This tab becomes leader: a new epoch, above every one it knows of. */
export function beginLeadership(): number {
  own = Math.max(storedEpoch(), followed, own) + 1;
  store(own);
  return own;
}

/**
 * This leader kept its leadership against another tab's, which some followers may already
 * follow: it moves above that epoch so those followers take it back.
 */
export function outbid(theirs: number): void {
  if (own > theirs) return;
  own = Math.max(storedEpoch(), theirs) + 1;
  store(own);
}

/** A follower hears a leader at `epoch`: true if it may follow it (not older than its own). */
export function admitLeaderEpoch(epoch: number): boolean {
  if (epoch < followed) return false;
  followed = epoch;
  return true;
}

/** Whether a leader's report at `epoch` comes from a leadership older than the one followed. */
export function isOlderThanFollowed(epoch: number): boolean {
  return epoch < followed;
}

/** This tab yielded to a leader at `epoch` and follows it from now on. */
export function followEpoch(epoch: number): void {
  followed = epoch;
}

/** The epoch this tab's messages carry: its own while leading, the one it follows otherwise. */
export function envelopeEpoch(isLeader: boolean): number {
  return isLeader ? own : followed;
}
