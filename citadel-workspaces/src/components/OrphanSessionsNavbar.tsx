import { useEffect } from "react";
import { debugLog } from "@/lib/debug-config";
import { OrphanSessionIcon } from "./OrphanSessionIcon";
import { DisconnectConfirmModal } from "./DisconnectConfirmModal";
import { DisconnectLoadingModal } from "./LoadingModal";
import { useOrphanSessions } from "./useOrphanSessions";
import { LazyTakeoverSignIn as TakeoverSignIn } from "./LazyTakeoverSignIn";

export const OrphanSessionsNavbar: () => JSX.Element | null = (): JSX.Element | null => {
  const {
    sessions,
    disconnectTarget,
    setDisconnectTarget,
    glowingSessionCid,
    notificationCounts,
    loadingModal,
    loadActiveSessions,
    handleNavigate,
    handleDisconnect,
    handleConfirmDisconnect,
    handleLoadingComplete,
    signInRequest,
    clearTakeover,
  } = useOrphanSessions();

  // Load sessions, and keep asking while the answer is still "none".
  //
  // This was a single call at mount. `getActiveSessions` is a round trip to the
  // internal service — and in a FOLLOWER tab it is proxied through the leader,
  // so early in startup it legitimately returns an empty list before the
  // session is visible. Nothing re-checked, so a second tab opened in the same
  // browser rendered the logged-out landing page with no "Active Sessions"
  // strip, permanently, while the first tab held a live workspace.
  //
  // An empty answer during startup is not yet evidence that there are no
  // sessions. It becomes evidence once we have asked for a while — hence a
  // BOUNDED retry rather than a poll: it stops the moment a session appears,
  // and it stops regardless after the window, so a genuinely session-less
  // landing page does not poll forever.
  const foundSessions: boolean = sessions.length > 0;
  useEffect(() => {
    if (foundSessions) return;

    let cancelled: boolean = false;
    let attempts: number = 0;
    const MAX_ATTEMPTS: number = 8;
    const RETRY_MS: number = 1_500;

    const load = (): void => {
      if (cancelled) return;
      attempts += 1;
      loadActiveSessions()
        // `loadActiveSessions` logs and keeps the last good list itself, so
        // this is the outer net rather than the reporting. Named so a reader
        // does not take the bare catch for an oversight.
        .catch((error: unknown) => debugLog('OrphanSessionsNavbar', 'Session reload attempt failed', error))
        .finally(() => {
          // foundSessions is in the dep array, so this effect is torn down and
          // not re-armed the moment a session appears.
          if (cancelled || attempts >= MAX_ATTEMPTS) return;
          timer = window.setTimeout(load, RETRY_MS);
        });
    };

    let timer: number = window.setTimeout(load, 0);
    return (): void => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [loadActiveSessions, foundSessions]);

  if (sessions.length === 0) {
    return null;
  }

  return (
    <>
      {/* Below the update/offline banner, not under it: that strip is fixed at the top of
          a header-less page and swallowed every click on these chips (measured live). */}
      <div
        className="fixed top-[var(--offline-banner-height,0px)] left-0 right-0 z-50 bg-background/95 backdrop-blur-sm border-b border-border"
        data-testid="previous-sessions-navbar"
      >
        <div className="container mx-auto px-6 py-2">
          <div className="flex items-center gap-3 min-w-0">
            <span className="text-xs font-semibold tracking-wider uppercase text-muted-foreground flex-shrink-0">
              Active Sessions
            </span>
            <div className="w-px h-4 bg-border flex-shrink-0" />
            <div
              className="flex items-center gap-2 overflow-x-auto scrollbar-none"
              style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
              data-testid="sessions-scroll-container"
            >
              {sessions.map((session) => (
                <OrphanSessionIcon
                  key={session.cid?.toString()}
                  session={session}
                  workspaceName={session.workspaceName}
                  onNavigate={() => handleNavigate(session)}
                  onDisconnect={() => handleDisconnect(session)}
                  shouldGlow={glowingSessionCid === session.cid}
                  unreadCount={notificationCounts.get(session.cid?.toString() ?? '') || 0}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      <TakeoverSignIn request={signInRequest} onClose={clearTakeover} />

      <DisconnectConfirmModal
        open={disconnectTarget !== null}
        onOpenChange={(open) => !open && setDisconnectTarget(null)}
        session={disconnectTarget?.session || null}
        workspaceName={disconnectTarget?.workspaceName || null}
        onConfirm={handleConfirmDisconnect}
      />

      <DisconnectLoadingModal
        open={loadingModal.open}
        status={loadingModal.status}
        workspaceName={loadingModal.workspaceName}
        errorMessage={loadingModal.errorMessage}
        onComplete={handleLoadingComplete}
        // The way out of a sign-out that has stalled. Closing the modal does
        // not abandon the request; it gives the app back.
        onCancel={handleLoadingComplete}
      />
    </>
  );
};
