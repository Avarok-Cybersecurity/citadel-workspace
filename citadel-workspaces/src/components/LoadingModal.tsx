import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { statusAppearance } from "./loading-modal-appearance";
import { LoadingModalSteps } from "./LoadingModalSteps";
import { LoadingModalRetry } from "./LoadingModalRetry";
import { Button } from "@/components/ui/button";
import { useDialogOverlay } from "@/hooks/use-dialog-overlay";

export interface LoadingModalStep {
  key: string;
  label: string;
  shortLabel: string;
}

export interface LoadingModalConfig {
  /** Test ID for the modal (e.g., "disconnect-loading-modal") */
  testId: string;
  /** Steps in the loading process */
  steps: LoadingModalStep[];
  /** Title shown for each status */
  titles: Record<string, string>;
  /** Description shown for each status */
  descriptions: Record<string, string>;
  /** Success message shown when ready */
  successMessage: string;
  /** Auto-close delay in ms after ready (default: 1500) */
  autoCloseDelay?: number;
}

interface LoadingModalProps {
  open: boolean;
  /** Current step key (must match one of config.steps[].key, or "ready" or "error") */
  status: string;
  /** Display name (username, workspace name, etc.) */
  displayName?: string;
  errorMessage?: string;
  onComplete?: () => void;
  /** Called when the user clicks cancel or the operation times out */
  onCancel?: () => void;
  onRetry?: () => void; // on an error, for an operation that can be run again
  /** Timeout in ms before auto-showing error state (default: 60000) */
  timeoutMs?: number;
  config: LoadingModalConfig;
}

export const LoadingModal = ({
  open,
  status,
  displayName,
  errorMessage,
  onComplete,
  onCancel,
  onRetry,
  timeoutMs = 60000,
  config,
}: LoadingModalProps): JSX.Element | null => {
  const [isVisible, setIsVisible] = useState(false);
  const [shouldRender, setShouldRender] = useState(false);
  const [timedOut, setTimedOut] = useState(false);

  // Handle mount/unmount animations
  useEffect(() => {
    if (open) {
      setShouldRender(true);
      requestAnimationFrame(() => {
        setIsVisible(true);
      });
    } else {
      setIsVisible(false);
      const timer: NodeJS.Timeout = setTimeout((): void => {
        setShouldRender(false);
      }, 300);
      return (): void => clearTimeout(timer);
    }
  }, [open]);

  // Auto-close after showing "ready" status
  useEffect(() => {
    if (status === "ready" && open) {
      const timer: NodeJS.Timeout = setTimeout((): void => {
        onComplete?.();
      }, config.autoCloseDelay ?? 1500);
      return (): void => clearTimeout(timer);
    }
  }, [status, open, onComplete, config.autoCloseDelay]);

  // Timeout: if operation takes too long, show a timed-out state
  useEffect(() => {
    if (!open || status === 'ready' || status === 'error') {
      setTimedOut(false);
      return;
    }
    const timer: NodeJS.Timeout = setTimeout((): void => {
      setTimedOut(true);
    }, timeoutMs);
    return (): void => clearTimeout(timer);
  }, [open, status, timeoutMs]);

  const { isLoading, isError, isReady, Icon, iconClass } = statusAppearance(status);
  const title: string = config.titles[status] || "Processing...";

  // Visually a modal; to assistive technology it was nothing at all -- a
  // fixed inset-0 scrim with a Cancel button, no role, no focus move, no trap,
  // no restore. Focus stayed on whatever submitted the form underneath, and Tab
  // walked invisible background controls. This hook was written for exactly
  // that and applied to six other overlays; the one sitting in the middle of
  // the login and registration flows was skipped.
  //
  // Dismissible only when there is something to dismiss to: Escape must not
  // appear to cancel an operation that has no cancel path.
  //
  // Above the early return, because hooks cannot be called conditionally --
  // `enabled` is what makes it inert while nothing is on screen, rather than
  // skipping the call.
  const { ref: dialogRef, dialogProps } = useDialogOverlay<HTMLDivElement>({
    label: title,
    onDismiss: onCancel && (isError || (isLoading && timedOut)) ? onCancel : undefined,
    enabled: shouldRender,
  });

  if (!shouldRender) return null;
  const description: string = errorMessage || config.descriptions[status] || "";

  // Find current step index for progress indicator
  const currentStepIndex: number = config.steps.findIndex((step) => step.key === status);

  return (
    <div
      ref={dialogRef}
      {...dialogProps}
      className={`fixed inset-0 z-[100] flex items-center justify-center transition-all duration-300 ${isVisible ? "opacity-100" : "opacity-0"
        }`}
      data-testid={config.testId}
    >
      {/* Backdrop */}
      <div
        className={`absolute inset-0 bg-black/70 backdrop-blur-sm transition-opacity duration-300 ${isVisible ? "opacity-100" : "opacity-0"
          }`}
      />

      {/* Modal Content */}
      <div
        // The headline changes as the flow advances and said nothing while it
        // did: during registration a screen-reader user got no signal at all
        // between submitting and landing in the workspace. Polite, not
        // assertive — this is progress, not an emergency.
        role="status"
        aria-live="polite"
        className={`relative z-10 bg-background border border-border rounded-xl p-8 max-w-sm w-full mx-4 shadow-2xl transform transition-all duration-300 ${isVisible ? "scale-100 opacity-100" : "scale-95 opacity-0"
          }`}
      >
        {/* Icon */}
        <div className="flex justify-center mb-6">
          <div className="relative">
            {isLoading && (
              <div className="absolute inset-0 bg-primary-accent/20 rounded-full blur-xl animate-pulse" />
            )}
            <Icon className={`w-16 h-16 ${iconClass} relative z-10`} />
          </div>
        </div>

        {/* Title */}
        <h2 className="text-xl font-semibold text-foreground text-center mb-2">
          {title}
        </h2>

        {/* Display name badge */}
        {displayName && (
          <div className="text-center mb-4">
            <span className="inline-flex items-center gap-2 px-3 py-1 bg-primary-accent/10 border border-primary-accent/30 rounded-full">
              <div className="w-2 h-2 rounded-full bg-primary-accent" />
              <span className="text-primary-accent font-medium text-sm">
                {displayName}
              </span>
            </span>
          </div>
        )}

        {/* Description */}
        <p className="text-muted-foreground text-center text-sm">{description}</p>

        {/* Progress indicator */}
        {isLoading && config.steps.length > 0 && (
          <LoadingModalSteps steps={config.steps} currentStepIndex={currentStepIndex} />
        )}

        {/* Success animation */}
        {isReady && (
          <div className="mt-4 flex justify-center">
            <span className="text-success-emphasis text-sm font-medium animate-pulse">
              {config.successMessage}
            </span>
          </div>
        )}

        {/* Timeout warning */}
        {timedOut && isLoading && (
          <div className="mt-4 text-center text-warning-emphasis text-sm">
            This is taking longer than expected.
          </div>
        )}

        {/* The way out.
            No caller ever passed `onCancel`, so this never rendered and Escape
            was inert -- a `fixed inset-0 z-[100]` overlay with no control on
            it. An operation that hung showed "This is taking longer than
            expected" and then nothing at all: the only way back to the app was
            to reload the page and lose whatever was in flight anyway.

            Offered once there is something to escape FROM -- an error, or a
            wait that has already outlasted its budget -- and not beside a
            spinner that is working, where it would invite people to abandon
            something about to succeed.

            "Dismiss", not "Cancel": nothing here can abort a request the
            service has already accepted, and a button that says Cancel next to
            a spinner promises exactly that. */}
        {onRetry && isError && <LoadingModalRetry onRetry={onRetry} />}
        {onCancel && (isError || (isLoading && timedOut)) && (
          <div className="mt-4 flex flex-col items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-foreground"
              onClick={onCancel}
              data-testid="loading-modal-dismiss"
            >
              <X className="h-4 w-4 mr-1" />
              Dismiss
            </Button>
            {isLoading && (
              <span className="text-xs text-muted-foreground">
                The operation keeps running.
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// Re-export configs and wrappers for backward compatibility
export {
  DISCONNECT_MODAL_CONFIG,
  CONNECT_MODAL_CONFIG,
  DisconnectLoadingModal,
  ConnectLoadingModal,
} from './LoadingModalConfigs';
export type { DisconnectStatus, ConnectStatus } from './LoadingModalConfigs';
