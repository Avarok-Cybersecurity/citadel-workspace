import { LoadingModal, type LoadingModalConfig } from './LoadingModal';

// Pre-configured modal configs for common use cases

export const DISCONNECT_MODAL_CONFIG: LoadingModalConfig = {
  testId: "disconnect-loading-modal",
  steps: [
    { key: "disconnecting", label: "Disconnecting Session", shortLabel: "Disconnect" },
    { key: "cleaning", label: "Cleaning Up", shortLabel: "Cleanup" },
  ],
  titles: {
    disconnecting: "Disconnecting Session",
    cleaning: "Cleaning Up",
    ready: "Session Disconnected",
    error: "Disconnect Failed",
  },
  descriptions: {
    disconnecting: "Closing connection to the server...",
    cleaning: "Finalizing session cleanup...",
    ready: "You can now safely reconnect or log in with another account.",
    error: "An error occurred while disconnecting.",
  },
  successMessage: "Safe to reconnect",
  autoCloseDelay: 1500,
};

/**
 * The modal a NEW account watches while it is created.
 *
 * `Join` is its only user, and the copy was written for a returning user: it
 * greeted someone eight seconds into their first account with "Welcome back!",
 * said "Verifying your credentials" while creating them, and showed a "Loading
 * Workspace" step that was set and replaced in the same tick -- a progress bar
 * for work that had already finished. The testId keeps its name because the
 * integration specs address it by that.
 */
export const CONNECT_MODAL_CONFIG: LoadingModalConfig = {
  testId: "connect-loading-modal",
  steps: [
    { key: "connecting", label: "Connecting", shortLabel: "Connect" },
    { key: "authenticating", label: "Creating Account", shortLabel: "Create" },
  ],
  titles: {
    connecting: "Connecting",
    authenticating: "Creating Your Account",
    ready: "Account Created",
    error: "Registration Failed",
  },
  descriptions: {
    connecting: "Establishing secure connection to the server...",
    authenticating: "Registering your account and signing you in...",
    ready: "Welcome. Taking you to your workspace...",
    error: "Your account could not be created. Please try again.",
  },
  successMessage: "Entering workspace",
  autoCloseDelay: 1000,
};

// Convenience wrapper components

export type DisconnectStatus = "disconnecting" | "cleaning" | "ready" | "error";

interface DisconnectLoadingModalProps {
  open: boolean;
  status: DisconnectStatus;
  workspaceName: string;
  errorMessage?: string;
  onComplete?: () => void;
  /** The way out of a stalled or failed operation. See LoadingModal. */
  onCancel?: () => void;
  onRetry?: () => void;
}

export const DisconnectLoadingModal = ({
  open,
  status,
  workspaceName,
  errorMessage,
  onComplete,
  onCancel,
  onRetry,
}: DisconnectLoadingModalProps): JSX.Element => (
  <LoadingModal
    open={open}
    status={status}
    displayName={workspaceName}
    errorMessage={errorMessage}
    onComplete={onComplete}
    onCancel={onCancel}
    onRetry={onRetry}
    config={DISCONNECT_MODAL_CONFIG}
  />
);

/** No "loading": the step it named was set and replaced in the same tick. */
export type ConnectStatus = "connecting" | "authenticating" | "ready" | "error";

interface ConnectLoadingModalProps {
  open: boolean;
  status: ConnectStatus;
  username?: string;
  errorMessage?: string;
  onComplete?: () => void;
  /** The way out of a stalled or failed operation. See LoadingModal. */
  onCancel?: () => void;
}

export const ConnectLoadingModal = ({
  open,
  status,
  username,
  errorMessage,
  onComplete,
  onCancel,
}: ConnectLoadingModalProps): JSX.Element => (
  <LoadingModal
    open={open}
    status={status}
    displayName={username}
    errorMessage={errorMessage}
    onComplete={onComplete}
    onCancel={onCancel}
    config={CONNECT_MODAL_CONFIG}
  />
);
