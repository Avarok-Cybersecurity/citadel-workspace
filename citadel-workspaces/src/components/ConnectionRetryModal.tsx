import React, { useState, useEffect, useRef, useCallback } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertCircle, ChevronRight, Loader2, RefreshCw, X } from "lucide-react";
import { useRetry } from "@/hooks/use-retry";
import { useEventListener } from "@/hooks/use-event-listener";
import { websocketService } from "@/lib/websocket-service";
import { useRetryCountdown } from './use-retry-countdown';
import { useToast } from "@/hooks/use-toast";
import { getUserFriendlyErrorMessage } from "@/lib/error-messages";
import { runAsyncSetup } from '@/lib/utils/async-utils';
import { debugLog } from '@/lib/debug-config';
import { AgentSetup } from './agent-setup/AgentSetup';
import { type ConnectionRetryModalProps } from './connection-retry-types';

export const ConnectionRetryModal: React.FC<ConnectionRetryModalProps> = ({
  isOpen,
  onClose,
  errorMessage = "Failed to connect to the workspace server",
  onRetry,
  maxRetries = 10,
  maxBackoffSeconds = 300
}) => {
  const userFriendlyError: string = errorMessage ? getUserFriendlyErrorMessage(errorMessage) : "Unable to connect to the workspace server.";
  const [hasInitialized, setHasInitialized] = useState(false);
  const { toast } = useToast();

  const retryFnRef: React.MutableRefObject<(() => Promise<unknown>) | null> = useRef<(() => Promise<unknown>) | null>(null);
  const retryInProgressRef: React.MutableRefObject<boolean> = useRef(false);
  const executeFnRef: React.MutableRefObject<(() => Promise<unknown>) | null> = useRef<(() => Promise<unknown>) | null>(null);

  const retryOperation: () => Promise<true | void> = useCallback(async (): Promise<true | void> => {
    if (onRetry) {
      return onRetry();
    }
    websocketService.reset();
    await websocketService.init();
    return true;
  }, [onRetry]);

  const {
    attempt,
    execute,
    retry: retryConnection,
    isLoading,
    error,
    reset: resetAttempts,
  } = useRetry(
    retryOperation,
    {
      maxRetries,
      retryDelay: 0,
      onSuccess: () => {
        toast({
          title: "Connection restored",
          description: "Successfully reconnected to the workspace server"
        });
        onClose();
      },
      onError: (error) => {
        debugLog('ConnectionRetryModal', 'Connection retry failed:', error);
      },
      onRetry: (attemptNum) => {
        debugLog('ConnectionRetryModal', `Retry attempt ${attemptNum} of ${maxRetries}`);
      }
    }
  );

  useEffect(() => {
    retryFnRef.current = retryConnection;
    executeFnRef.current = execute;
  }, [retryConnection, execute]);

  useEffect(() => {
    if (isOpen && !hasInitialized && attempt === 0) {
      setHasInitialized(true);
      const executeFn: (() => Promise<unknown>) | null = executeFnRef.current;
      if (executeFn) {
        runAsyncSetup(() => executeFn());
      }
    }

    if (!isOpen && hasInitialized) {
      setHasInitialized(false);
    }
  }, [isOpen, hasInitialized, attempt]);

  const { countdown, resetCountdown } = useRetryCountdown({
    isOpen, isLoading, attempt, maxRetries, maxBackoffSeconds, retryFnRef, retryInProgressRef,
  });

  // 'on-ws-connection-success' is what the socket layer actually emits; this
  // listened for 'connection-success', which nothing emits, so a connection
  // recovered by any other path never closed the modal. Resetting the counter
  // is the other half: `maxRetries` is a per-OUTAGE budget, but reset was never
  // called, so it accumulated across the tab's lifetime — after ten failures
  // spread over hours, every later disconnection opened a modal with Retry
  // already disabled and no recovery but a reload.
  useEventListener('on-ws-connection-success', () => {
    resetAttempts();
    onClose();
  }, [onClose, resetAttempts]);

  const handleManualRetry = (): void => {
    resetCountdown();
    // `maxRetries` bounds the MACHINE's patience; it was never meant to bound
    // the person's. A laptop asleep through ten backed-off attempts -- about 18
    // minutes -- woke into a modal whose Retry button refused to retry, on a
    // connection that was by then very likely fine, with a reload as the only
    // way out.
    //
    // Enabling the button is not enough on its own. `retry` keeps incrementing
    // `attempt` and refuses once it passes `maxRetries` (use-retry), so with it
    // the button would work exactly once more and then be dead again. A manual
    // press past the budget starts a fresh series instead, which also lets the
    // automatic countdown pick back up.
    const exhausted: boolean = attempt >= maxRetries;
    const retryFn: (() => Promise<unknown>) | null = exhausted ? executeFnRef.current : retryFnRef.current;
    if (retryFn && !retryInProgressRef.current) {
      retryInProgressRef.current = true;
      runAsyncSetup(async () => {
        try {
          await retryFn();
        } finally {
          retryInProgressRef.current = false;
        }
      });
    }
  };

  const handleCancel = (): void => {
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md" data-testid="connection-retry-modal">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-destructive" />
            Connection Failed
          </DialogTitle>
          <DialogDescription className="pt-2">
            {userFriendlyError}
          </DialogDescription>
        </DialogHeader>

        <AgentSetup layout="compact" navigatorRef={navigator} />

        <div className="space-y-4 py-4">
          {/* Radix announces title+description once and nothing after, so
              retry progress reached nobody. Mounted so it pre-exists its text. */}
          <div className="text-sm text-muted-foreground" role="status">
            {isLoading ? (
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Attempting to reconnect... (attempt {attempt} of {maxRetries})</span>
              </div>
            ) : attempt >= maxRetries ? (
              <div className="text-destructive-emphasis">
                Failed to reconnect after {maxRetries} attempts
              </div>
            ) : attempt > 0 ? (
              <div>
                Attempt {attempt} failed. Waiting to retry...
              </div>
            ) : (
              <div>
                Connecting...
              </div>
            )}
          </div>

          {!isLoading && attempt > 0 && attempt < maxRetries && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span>Next retry in:</span>
                <div className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin text-primary-accent" />
                  <span className="font-mono">
                    {countdown >= 60
                      ? `${Math.floor(countdown / 60)}:${String(countdown % 60).padStart(2, '0')}`
                      : `${countdown}s`
                    }
                  </span>
                </div>
              </div>
            </div>
          )}

          {error && (
            // Collapsed, and no longer styled as an alarm. The friendly message
            // above already says what happened and what to do; this is the raw
            // error, which for a failed WASM start is Rust's Debug formatting
            // of an internal enum — `ConnectionFailed { event: CloseEvent {
            // code: 0, reason: "", was_clean: true } }` was shown to users, in
            // red, directly beneath the plain-language explanation. Worth
            // keeping for a bug report; not worth leading with.
            //
            // min-h-[24px] on the summary because it is the interactive element here
            // and a bare line of text falls under the 24px WCAG 2.2 target.
            <details className="group rounded-md bg-muted/50 p-3 text-sm">
              {/* The chevron is not decoration. A `summary` laid out as flex
                  loses its native disclosure marker, which left this looking
                  like an inert grey box with no sign it opened at all. */}
              <summary className="flex min-h-[24px] cursor-pointer items-center gap-1.5 text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
                <ChevronRight
                  className="h-3.5 w-3.5 shrink-0 transition-transform group-open:rotate-90"
                  aria-hidden="true"
                />
                Technical details
              </summary>
              <p className="mt-2 break-words font-mono text-xs text-muted-foreground">
                {error.message}
              </p>
            </details>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={handleCancel}
            data-testid="connection-retry-cancel"
          >
            <X className="h-4 w-4 mr-2" />
            Cancel
          </Button>
          <Button
            onClick={handleManualRetry}
            disabled={isLoading}
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Retry Now
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
