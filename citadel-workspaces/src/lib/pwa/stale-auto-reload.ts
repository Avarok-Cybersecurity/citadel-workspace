/**
 * A stale tab (multi-instance/tab-staleness.ts) reloads by itself once it has been hidden for a
 * while and a reload is safe (reload-safety.ts).
 *
 * The banner asks a person who is looking. A tab left in the background is the case that kept
 * an old build open across deploys in the first place: nobody looks at it, so nobody presses
 * the button. Hidden long enough, it is not in use, and reloading it loses nothing that the
 * reload does not carry.
 */
export interface StaleAutoReloadIO {
  /** How long the tab must have been hidden; INTERVAL.STALE_HIDDEN_RELOAD_MS in the app. */
  readonly hiddenForMs: number;
  now: () => number;
  isHidden: () => boolean;
  onVisibilityChange: (listener: () => void) => () => void;
  isStale: () => boolean;
  onStaleChange: (listener: () => void) => () => void;
  reloadIsSafe: () => boolean;
  onReloadSafe: (listener: () => void) => () => void;
  schedule: (fn: () => void, ms: number) => () => void;
  /** Carries drafts and applies a waiting service worker (watch-tab-staleness.ts). */
  reload: () => void;
}

/** Start watching; returns the stop function. Reloads at most once. */
export function startStaleAutoReload(io: StaleAutoReloadIO): () => void {
  let hiddenSince: number | null = io.isHidden() ? io.now() : null;
  let cancelTimer: (() => void) | null = null;
  let reloaded: boolean = false;

  const evaluate = (): void => {
    cancelTimer?.();
    cancelTimer = null;
    if (reloaded || hiddenSince === null || !io.isStale()) return;
    const remaining: number = io.hiddenForMs - (io.now() - hiddenSince);
    if (remaining > 0) {
      cancelTimer = io.schedule(evaluate, remaining);
      return;
    }
    if (!io.reloadIsSafe()) return; // onReloadSafe asks again.
    reloaded = true;
    io.reload();
  };

  const onVisibility = (): void => {
    hiddenSince = io.isHidden() ? (hiddenSince ?? io.now()) : null;
    evaluate();
  };

  const stops: Array<() => void> = [
    io.onVisibilityChange(onVisibility),
    io.onStaleChange(evaluate),
    io.onReloadSafe(evaluate),
  ];
  evaluate();
  return (): void => {
    cancelTimer?.();
    for (const stop of stops) stop();
  };
}
