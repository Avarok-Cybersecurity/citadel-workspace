import { isPlaceholderName } from '@/lib/peer-display';
import React, { useEffect, useState } from 'react';
import {
  initPromptSuppressed,
  suppressInitPrompt,
  clearInitPromptSuppression,
} from '@/lib/workspace-init-prompt';
import { WorkspaceProvider, WorkspaceState } from '@/contexts/WorkspaceContext';
import WorkspaceService from '../lib/workspace-service';
import { lazyDialog } from './lazy-dialog';
import type { WorkspaceInitializationModalProps } from './workspace-init-types';

/** Fetched only when a workspace needs initialising, which a seeded server never does. */
const WorkspaceInitializationModal: (props: WorkspaceInitializationModalProps) => JSX.Element | null = lazyDialog(
  (): Promise<React.ComponentType<WorkspaceInitializationModalProps>> =>
    import('./WorkspaceInitializationModal').then((m) => m.WorkspaceInitializationModal),
  (props: WorkspaceInitializationModalProps): boolean => props.isOpen,
);
import { connectionManager } from '../lib/connection';
import { useWorkspaceAddress } from '@/hooks/use-workspace-address';
import { useTabIdentity } from '@/hooks/use-tab-identity';
import type { TabIdentity } from '@/lib/tab-identity';

import {
  useWorkspaceEventSetup,
  useMemberEventSetup,
  useEventEmitterSetup,
  useNodeEventSetup,
  useMessageEventSetup,
} from './hooks';
import { debugLog } from '@/lib/debug-config';
import { WorkspaceThemeProvider } from './theme/WorkspaceThemeProvider';
import { ClaimLaterBanner } from './ClaimLaterBanner';
import { publishChannelNames } from '@/lib/call/room-names';
import { saveKeptTree, useKeepWorkspaceTree } from '@/hooks/use-kept-tree';

/**
 * The event handler's state: the context's `WorkspaceState`, plus the one field
 * only this component sets.
 *
 * `extends`, not a parallel copy passed through `state as WorkspaceState`. The
 * two had drifted into near-identical lists bridged by a cast, so a field added
 * to this one was invisible to consumers reading the other -- which is how
 * `nodesUnavailable` compiled here and failed at the sidebar that needed it.
 *
 * Making it extend required the writer to stop storing decoded JSON in
 * `workspace.metadata`, which is declared as the raw bytes it arrives as. That
 * mismatch had been true for as long as the cast had.
 */
export interface WorkspaceEventState extends WorkspaceState {
  needsWorkspaceInitialization?: boolean;
}


/**
 * Component that handles workspace events and provides a central place
 * for managing workspace state updates.
 */
export const WorkspaceEventHandler: React.FC<{
  onStateChange?: (state: WorkspaceEventState) => void;
  children?: React.ReactNode;
}> = ({ onStateChange, children }) => {
  const [state, setState] = useState<WorkspaceEventState>({
    workspace: undefined,
    nodes: {},
    treeSchema: null,
    members: {},
    loading: { workspace: false, members: false, nodes: false },
    nodesUnavailable: false,
    membershipRefused: false,
    needsWorkspaceInitialization: false,
    messages: {
      byPeer: {} as Record<string, Array<{
        content: string; timestamp: number; id?: string; pending?: boolean;
      }>>,
      lastMessageTimestamp: Date.now(),
    },
    typing: { peerIds: [], lastUpdated: Date.now() }
  });

  const [showInitModal, setShowInitModal] = useState(false);
  // This tab's workspace and account. These read the FIRST saved account in the
  // browser, so with another account saved the dialog named that account's
  // server -- and the claim-code prefill, which matches on the server, never
  // fired for the workspace just created (live, test-sep25 showed admin-lab).
  const initServer: string | undefined = useWorkspaceAddress(showInitModal, connectionManager.getConnectionInfo()?.serverAddress);
  const tabUser: TabIdentity | null = useTabIdentity();
  const [initModalDismissed, setInitModalDismissed] = useState(() => {
    return initPromptSuppressed();
  });

  useEffect(() => {
    if (state.needsWorkspaceInitialization && !showInitModal && !initModalDismissed) {
      debugLog('WorkspaceEventHandler', 'Workspace needs initialization - showing modal');
      setShowInitModal(true);
    }
  }, [state.needsWorkspaceInitialization, showInitModal, initModalDismissed]);

  // Use extracted hooks for event setup
  useWorkspaceEventSetup({ setState });
  useMemberEventSetup({ setState });
  useNodeEventSetup({ setState });
  useEventEmitterSetup({ setState });
  useMessageEventSetup({ setState });

  // `state.messages.byPeer` is deliberately NOT persisted.
  //
  // Nothing renders it. Across the whole app there are nine references: two type
  // declarations, an empty initial value, this component's load/save pair, and
  // three in useMessageEventSetup's append path. Every surface that shows
  // messages — useP2PMessages, P2PPeerList, GroupChatView — reads
  // `conversation.messages` from the IndexedDB pagination store instead.
  //
  // Persisting it therefore bought nothing and cost three things: it rewrote the
  // ENTIRE per-peer map to localStorage on every received message, against a
  // ~5MB cap, after which every write throws QuotaExceededError and the app
  // carries on looking fine; it JSON.stringified data containing BigInt CIDs
  // through a replacer, which CLAUDE.md explicitly forbids ("browser storage:
  // IndexedDB", "NO JSON.stringify for data containing BigInt"); and it was a
  // second message cache shadowing the one the UI actually reads.
  //
  // The in-memory state stays, so the event path is untouched.

  useEffect(() => {
    if (onStateChange) onStateChange(state);
  }, [state, onStateChange]);

  // The ring card sits above this provider; see lib/call/room-names.ts.
  useEffect(() => {
    publishChannelNames(state.nodes);
  }, [state.nodes]);

  // The tree as the server last listed it, kept on this device so a document opens while the
  // server is out of reach (lib/offline-tree.ts). Only a live answer is kept, never an empty one.
  useKeepWorkspaceTree(saveKeptTree, state.nodes, state.loading.nodes);

  const handleWorkspaceInitialized = (): void => {
    setShowInitModal(false);
    clearInitPromptSuppression();
    setState(prev => ({ ...prev, needsWorkspaceInitialization: false, error: undefined }));
    WorkspaceService.loadWorkspace()
      .then(() => debugLog('WorkspaceEventHandler', 'Workspace reloaded after initialization'))
      .catch(error => debugLog('WorkspaceEventHandler', 'Error reloading workspace after initialization:', error));
  };

  /**
   * Cancelling initialisation means declining to set this workspace up, so it
   * returns to the index rather than leaving the user inside a workspace that
   * does not exist yet — which showed an empty, non-functional shell with no
   * way back and no explanation.
   *
   * A location assignment, NOT useNavigate: this component is mounted ABOVE
   * BrowserRouter (App.tsx renders WorkspaceApp outside it), so the router hooks
   * throw here and take the whole app down with them — tsc cannot see that, and
   * the first symptom is a blank page. A full load is also the right semantics
   * for declining setup, since it drops the half-built workspace context.
   */
  const handleInitCancelled = (): void => {
    setShowInitModal(false);
    setInitModalDismissed(true);
    // Less severe than the onboarding caller's version of this: `initModalDismissed`
    // above already keeps the prompt closed for THIS mount, so a storage refusal
    // only means it returns after a reload rather than immediately.
    if (!suppressInitPrompt()) {
      debugLog(
        'WorkspaceEventHandler',
        'Could not record the dismissal: session storage is unavailable, so the ' +
          'initialization prompt will return after a reload.',
      );
    }
    // Deliberately no navigation.
    //
    // This used to `window.location.assign('/')`, throwing the user out of the
    // workspace they had just successfully joined. Initialization needs the
    // operator's WORKSPACE_MASTER_PASSWORD, which no ordinary member has — and
    // this modal is shown to EVERY user until somebody completes it — so the
    // only available action ejected them.
    //
    // The dismissal is already recorded above and the workspace is already
    // usable: the root workspace is seeded at boot and Admin is granted at
    // connect to the first member, so nothing here gates access.
  };

  return (
    <>
      <WorkspaceProvider state={state}>
        {/* Inside WorkspaceProvider: the theme lives in the workspace's metadata,
            so it can only be read once the workspace is in context. */}
        <WorkspaceThemeProvider>{children}</WorkspaceThemeProvider>
      </WorkspaceProvider>
      <ClaimLaterBanner
        visible={state.needsWorkspaceInitialization === true && initModalDismissed && !showInitModal && !state.membershipRefused}
        onClaim={(): void => { clearInitPromptSuppression(); setInitModalDismissed(false); }}
      />
      <WorkspaceInitializationModal
        // A removed account is told it was refused, never offered to set the workspace up.
        isOpen={showInitModal && !state.membershipRefused}
        onClose={handleInitCancelled}
        onSuccess={handleWorkspaceInitialized}
        workspaceName={state.workspace?.name}
        workspaceId={state.workspace?.id || 'root'}
        serverAddress={initServer}
        username={isPlaceholderName(state.currentUser?.username) ? tabUser?.username : state.currentUser?.username}
        fullName={isPlaceholderName(state.currentUser?.name) ? tabUser?.fullName : state.currentUser?.name}
      />
    </>
  );
};

export default WorkspaceEventHandler;
