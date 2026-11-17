import type { ReactNode, ErrorInfo } from 'react';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { reloadApplyingAnyWaitingUpdate } from '@/lib/pwa/apply-waiting-update';
import { errorLog } from '@/lib/debug-config';

/**
 * The application's outermost error boundary.
 *
 * `ui/error-boundary.tsx` existed but was mounted in exactly one place
 * (LiveDocumentView), so a render error anywhere else — a sidebar, a modal, the
 * workspace shell — unmounted the whole React tree and left a blank page. The
 * only safety net was the raw-DOM handler in main.tsx, which catches failures
 * during initialisation and not renders that happen afterwards. For a security
 * product, silently going white is the worst available failure mode: the user
 * cannot tell a crash from a hang from a lost connection.
 *
 * The fallback is deliberately plain: it must not depend on anything that could
 * itself be the thing that just failed, so it uses no context, no services and
 * no theme lookup.
 */

function FullPageError({ onReload }: { onReload: () => void }): JSX.Element {
  return (
    <div
      role="alert"
      aria-live="assertive"
      // Named so a check can tell "the app mounted" from "the app crashed and
      // this rendered instead". Two production checks asserted only that #root
      // had children, which this satisfies -- so both reported a mounted app
      // while every single production load was this screen.
      data-testid="app-crashed"
      className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-background px-6 text-center text-foreground"
    >
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
        <svg
          className="h-8 w-8 text-destructive"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
          />
        </svg>
      </div>

      <h1 className="text-xl font-semibold">Something went wrong</h1>

      <p className="max-w-md text-sm text-muted-foreground">
        The workspace hit an unexpected error and could not continue. Your account and
        messages are unaffected — reloading will reconnect you.
      </p>

      <button
        type="button"
        onClick={onReload}
        className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        Reload workspace
      </button>
    </div>
  );
}

export function AppErrorBoundary({ children }: { children: ReactNode }): JSX.Element {
  const handleError = (error: Error, errorInfo: ErrorInfo): void => {
    // Always logged, in every build: this is the one error the user cannot
    // report usefully themselves, because the screen it happened on is gone.
    errorLog('AppErrorBoundary', 'Unhandled render error', error, errorInfo.componentStack);
  };

  return (
    <ErrorBoundary
      onError={handleError}
      // Not a plain reload: if a fixed build is sitting in `waiting`, a same-tab
      // reload leaves the old worker serving the old, crashing shell, and this
      // button loops on it for ever. PwaUpdatePrompt is the only other sender of
      // SKIP_WAITING and it is unmounted whenever this fallback is showing.
      fallback={
        <FullPageError
          onReload={() => {
            void reloadApplyingAnyWaitingUpdate(() => window.location.reload());
          }}
        />
      }
    >
      {children}
    </ErrorBoundary>
  );
}
