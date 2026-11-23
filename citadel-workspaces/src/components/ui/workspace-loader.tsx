import React, { lazy, Suspense, useCallback, useEffect, useState, useRef, useSyncExternalStore } from 'react';
import { useWorkspaceDataTimeout } from './use-workspace-data-timeout';
import { ConnectionService } from '@/lib/connection-service';
import { TIMEOUT } from '@/lib/timeout-constants';
import { useAutoClaimSession } from './use-auto-claim-session';
import { useNavigate } from 'react-router-dom';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { debugLog } from '@/lib/debug-config';
import { useToast } from '@/hooks/use-toast';
import { WorkspaceLoaderSpinner, WorkspaceRefusedNotice } from './workspace-loader-ui';
import { useHeldElsewhere, type HeldElsewhere } from './use-held-elsewhere';
import { onThisTabDetached } from '@/lib/sessions/detached';
import { useLeaveEndedSession, type LeaveEndedSession } from '@/components/use-leave-ended-session';
import type { NavigateFunction } from 'react-router';
import { reconnectingTo, signInAfterLoss, type SignInAfterLoss } from '@/lib/reconnect/server-reconnect';
import { resolvePendingRedirect } from '@/lib/share/resolve-here';
import { loaderView, shouldLeaveForConnect, type LoaderInputs, type LoaderView } from './workspace-loader-state';
import { loadKeptTree, useKeptTree, type KeptTree } from '@/hooks/use-kept-tree';
import { outage, type Outage } from '@/lib/reconnect/outage';
import { OutageNotice } from '@/components/outage/OutageNotice';

// The marketplace's host once a workspace is up (app links, zones, the account menu); the modal loads on first open.
const AppsModalHost: React.LazyExoticComponent<() => JSX.Element | null> = lazy(() =>
  import('@/components/citadel-apps/marketplace/AppsModalHost').then((m) => ({ default: m.AppsModalHost })));


interface WorkspaceLoaderProps {
  children: React.ReactNode;
}

/**
 * A component that only renders its children when the workspace is fully loaded
 * Shows a loading state while workspace data is being fetched
 * Redirects to connect page if no active connection after a timeout
 */
export const WorkspaceLoader: React.FC<WorkspaceLoaderProps> = ({ children }) => {
  const { state } = useWorkspace();
  const navigate: NavigateFunction = useNavigate();
  const { toast } = useToast();
  const [hasConnection, setHasConnection] = useState<boolean | null>(null);
  const [loadingTimeout, setLoadingTimeout] = useState(false);
  const [isAutoClaimingSession, setIsAutoClaimingSession] = useState(false);
  const autoClaimAttempted: React.MutableRefObject<boolean> = useRef(false);
  // Another browser holds this tab's session: the switcher's takeover, not a hang. See use-held-elsewhere.
  const heldElsewhere: ReturnType<typeof useHeldElsewhere> = useHeldElsewhere();
  // Let go of mid-session, when another window took it over: offered back the same way,
  // and left for the landing page if the user does not take it.
  const leave: LeaveEndedSession = useLeaveEndedSession();
  const offerBack: HeldElsewhere['offer'] = heldElsewhere.offer;
  useEffect(() => onThisTabDetached((name: string): void => offerBack(name, (): void => {
    leave('/', `${name} is open in another window now.`).catch((e: unknown): void => debugLog('WorkspaceLoader', 'Leaving failed', e));
  })), [offerBack, leave]);
  // The agent's own word that it is bringing this session's server link back.
  const reconnectingServer: string | null = useSyncExternalStore(reconnectingTo.subscribe, reconnectingTo.get);
  const kept: KeptTree = useKeptTree(loadKeptTree, reconnectingServer !== null);
  // The link's wait outlasted an ordinary drop, or the agent gave up on a server that never answered.
  const shownOutage: Outage | null = useSyncExternalStore(outage.subscribe, outage.get);
  // A gone session's Retry is its sign-in (unsaved editor text asked about first); otherwise the page again.
  const retry: () => void = useCallback((): void => {
    const signIn: Outage['signIn'] = outage.get()?.signIn ?? null;
    if (signIn === null) return window.location.reload();
    outage.set(null);
    leave(signIn.path, signIn.message).catch((e: unknown): void => debugLog('WorkspaceLoader', 'Leaving failed', e));
  }, [leave]);

  // Sign-in for that account, not /connect's server picker: the session is gone and
  // nothing else here can bring it back.
  const onSessionEnded: (username: string, server: string, reason: string) => void = useCallback((username: string, server: string, reason: string): void => {
    const signIn: SignInAfterLoss = signInAfterLoss(username, server, reason, null);
    toast({ title: 'Signed out', description: signIn.message, variant: 'destructive' });
    navigate(signIn.path);
  }, [navigate, toast]);

  // Check for dev mode
  const urlParams: URLSearchParams = new URLSearchParams(window.location.search);
  const isDevMode: boolean = urlParams.get('dev') === 'true' && import.meta.env.VITE_DEV_MODE === 'true';

  // Check if workspace is still loading
  const isLoading: boolean =
    !state.workspace ||
    state.loading.workspace ||
    state.loading.nodes;

  useAutoClaimSession({
    isDevMode,
    toast,
    setHasConnection,
    setIsAutoClaimingSession,
    autoClaimAttempted,
    onHeldElsewhere: heldElsewhere.offer,
    onSessionEnded,
  });

  useEffect(() => {
    if (isDevMode) return;

    const connectionService: ConnectionService = ConnectionService.getInstance();
    let mounted: boolean = true;

    // `mounted` made stale handlers inert but never removed them. See onConnectionChange.
    const unsubscribeConnection: () => void = connectionService.onConnectionChange((connection): void => {
      if (mounted) {
        setHasConnection(!!connection?.isConnected);
      }
    });

    const timeout: NodeJS.Timeout = setTimeout((): void => {
      if (mounted && isLoading && !hasConnection) {
        setLoadingTimeout(true);
      }
    }, TIMEOUT.SERVER_REQUEST_MS);

    return (): void => {
      mounted = false;
      unsubscribeConnection();
      clearTimeout(timeout);
    };
  }, [isLoading, hasConnection, isDevMode]);

  // Secondary safety net: workspace data loading timeout
  const workspaceDataTimeout: boolean = useWorkspaceDataTimeout(hasConnection, isLoading, isDevMode);

  const inputs: LoaderInputs = {
    isLoading,
    isAutoClaiming: isAutoClaimingSession,
    loadingTimeout,
    hasConnection,
    workspaceDataTimeout,
    heldElsewhere: heldElsewhere.username !== null,
    reconnectingTo: reconnectingServer,
    keptTree: kept.kind === 'kept',
    keptTreeLocked: kept.kind === 'locked',
    refused: state.membershipRefused,
    outage: shownOutage?.kind ?? null,
  };
  const leaveForConnect: boolean = shouldLeaveForConnect(inputs);

  useEffect(() => {
    if (isDevMode || !leaveForConnect) return;
    debugLog('WorkspaceLoader', ' No connection detected after timeout, redirecting to connect');
    navigate('/connect');
  }, [leaveForConnect, navigate, isDevMode]);

  // Loaded: a secure link waiting since sign-in (a reload, an auto-claim) is opened now.
  const view: LoaderView = loaderView(inputs);
  useEffect(() => {
    if (!isDevMode && view.kind === 'ready') void resolvePendingRedirect(navigate, null);
  }, [view.kind, navigate, isDevMode]);

  if (isDevMode) {
    debugLog('WorkspaceLoader', 'Dev mode: Bypassing workspace loader');
    return <>{children}</>;
  }

  if (view.kind === 'held-elsewhere') return heldElsewhere.notice;
  if (view.kind === 'refused') return <WorkspaceRefusedNotice />;
  if (view.kind === 'spinner') {
    return <WorkspaceLoaderSpinner loadingMessage={view.message} showConnectButton={view.showConnectButton} />;
  }
  const notice: JSX.Element | null = view.kind === 'unavailable' ? <OutageNotice kind={view.outage} onRetry={retry} /> : null;
  // A workspace that was open stays mounted under the notice, out of reach: unmounting it
  // would drop unsaved editor text and a call in progress for a link that may be back in a minute.
  if (notice !== null && loaderView({ ...inputs, outage: null }).kind !== 'ready') return notice;

  return (
    <>
      <div style={{ display: 'contents' }} {...(notice === null ? {} : { inert: '' })} data-testid="workspace-under-loader">{children}</div>
      <Suspense fallback={null}><AppsModalHost /></Suspense>
      {notice}
    </>
  );
}

export default WorkspaceLoader;
