/**
 * What the workspace loader shows, and whether it gives up for /connect -- decided
 * here, from what the loader knows, so the rules can be read and tested apart from
 * the effects that carry them out.
 *
 * `reconnectingTo` is the agent's own report that it is bringing this session's
 * server link back (server-reconnect.ts). While it stands, neither "no connection"
 * nor "no data yet" is a reason to leave: /connect cannot help a session the agent
 * is already restoring, and the data comes once the link does. And while it stands, a tree
 * kept on this device (`keptTree`) lets the workspace open, labelled as offline, rather than
 * hold every document behind the spinner until the server answers.
 */
import { reconnectingMessage } from '@/lib/reconnect/server-reconnect';

/** Here, not with the rest of encryption at rest's words (at-rest-copy.ts): the loader is on the landing path. */
export const LOCKED_TREE_NOTICE: string = 'The workspace tree kept on this device is locked, so the workspace opens once the server answers.';

export interface LoaderInputs {
  isLoading: boolean;
  isAutoClaiming: boolean;
  loadingTimeout: boolean;
  hasConnection: boolean | null;
  workspaceDataTimeout: boolean;
  heldElsewhere: boolean;
  reconnectingTo: string | null;
  /** A last-known tree is kept on this device for this session's account. */
  keptTree: boolean;
  /** One is kept, sealed, and cannot be opened here. */
  keptTreeLocked: boolean;
  /** The server refused this account the workspace (lib/membership-refusal.ts): no wait ends that. */
  refused: boolean;
}

export type LoaderView =
  | { kind: 'ready' }
  | { kind: 'held-elsewhere' }
  | { kind: 'refused' }
  | { kind: 'spinner'; message: string; showConnectButton: boolean };

export function shouldLeaveForConnect(inputs: LoaderInputs): boolean {
  return inputs.loadingTimeout
    && !inputs.hasConnection
    && inputs.isLoading
    && !inputs.isAutoClaiming
    && !inputs.heldElsewhere
    && inputs.reconnectingTo === null;
}

function spinnerMessage(inputs: LoaderInputs): string {
  if (inputs.isAutoClaiming) return 'Connecting to session...';
  if (inputs.reconnectingTo !== null) return inputs.keptTreeLocked ? `${reconnectingMessage(inputs.reconnectingTo)} ${LOCKED_TREE_NOTICE}` : reconnectingMessage(inputs.reconnectingTo);
  if (inputs.workspaceDataTimeout) return 'Workspace data is taking longer than expected...';
  if (inputs.loadingTimeout) return 'Checking connection...';
  return 'Loading workspace...';
}

export function loaderView(inputs: LoaderInputs): LoaderView {
  if (inputs.refused) return { kind: 'refused' };
  if (inputs.isLoading && inputs.heldElsewhere) return { kind: 'held-elsewhere' };
  if (!inputs.isLoading && !inputs.isAutoClaiming) return { kind: 'ready' };
  if (inputs.reconnectingTo !== null && inputs.keptTree && !inputs.isAutoClaiming) return { kind: 'ready' };
  const waitingOnTheAgent: boolean = inputs.reconnectingTo !== null;
  return {
    kind: 'spinner',
    message: spinnerMessage(inputs),
    showConnectButton: !waitingOnTheAgent
      && ((inputs.loadingTimeout && !inputs.isAutoClaiming) || inputs.workspaceDataTimeout),
  };
}
