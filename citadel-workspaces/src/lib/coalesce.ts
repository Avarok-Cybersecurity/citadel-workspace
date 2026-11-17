/**
 * Run `action` once for a burst of requests: the first request starts a `windowMs` wait, the ones
 * that arrive during it join it, and `action` runs when it ends.
 *
 * For reactions to server announcements, which come in bursts (several colleagues joining, or a
 * write's own confirmation followed by the broadcast of the same change), where each request
 * would otherwise be a round trip asking the same question.
 */
export interface Coalesced {
  request(): void;
  /** Drop a pending run, for an owner that is going away. */
  cancel(): void;
}

export function coalesce(action: () => void, windowMs: number): Coalesced {
  let pending: ReturnType<typeof setTimeout> | null = null;
  return {
    request: (): void => {
      if (pending !== null) return;
      pending = setTimeout((): void => {
        pending = null;
        action();
      }, windowMs);
    },
    cancel: (): void => {
      if (pending !== null) clearTimeout(pending);
      pending = null;
    },
  };
}
