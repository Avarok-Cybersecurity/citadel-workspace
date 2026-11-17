/**
 * What the workspace loader shows, and when it gives up for /connect.
 *
 * Live: a page reloaded while the agent was reconnecting to its server timed out
 * and sent the user to /connect -- where signing in cannot help, because the
 * agent is already bringing the session back -- or sat on "taking longer than
 * expected". While the agent says it is reconnecting, that is what the loader
 * says, and it waits.
 */
import { describe, it, expect } from 'vitest';
import { LOCKED_TREE_NOTICE, loaderView, shouldLeaveForConnect, type LoaderInputs } from '../workspace-loader-state';

const TIMED_OUT: LoaderInputs = {
  isLoading: true,
  isAutoClaiming: false,
  loadingTimeout: true,
  hasConnection: null,
  workspaceDataTimeout: false,
  heldElsewhere: false,
  reconnectingTo: null,
  keptTree: false,
  keptTreeLocked: false,
  refused: false,
};

describe('the workspace loader', () => {
  it('leaves for /connect when nothing is connected after the timeout', () => {
    expect(shouldLeaveForConnect(TIMED_OUT)).toBe(true);
  });

  it('waits instead while the agent is reconnecting the session', () => {
    expect(shouldLeaveForConnect({ ...TIMED_OUT, reconnectingTo: 'acme.work.example.net' })).toBe(false);
  });

  it('says it is reconnecting, and to where, rather than "taking longer than expected"', () => {
    const view: ReturnType<typeof loaderView> = loaderView({
      ...TIMED_OUT,
      hasConnection: true,
      workspaceDataTimeout: true,
      reconnectingTo: 'acme.work.example.net',
    });
    expect(view).toEqual({ kind: 'spinner', message: 'Reconnecting to acme.work.example.net…', showConnectButton: false });
  });

  it('still reports data that never came on a connection that is up', () => {
    expect(loaderView({ ...TIMED_OUT, hasConnection: true, workspaceDataTimeout: true })).toEqual({
      kind: 'spinner',
      message: 'Workspace data is taking longer than expected...',
      showConnectButton: true,
    });
  });

  it('renders the workspace once it has loaded', () => {
    expect(loaderView({ ...TIMED_OUT, isLoading: false })).toEqual({ kind: 'ready' });
  });

  it('offers the takeover when another browser holds the session', () => {
    expect(loaderView({ ...TIMED_OUT, heldElsewhere: true })).toEqual({ kind: 'held-elsewhere' });
    expect(shouldLeaveForConnect({ ...TIMED_OUT, heldElsewhere: true })).toBe(false);
  });

  it('opens the workspace, offline, while the agent reconnects and this device kept the tree', () => {
    expect(loaderView({ ...TIMED_OUT, reconnectingTo: 'acme.work.example.net', keptTree: true })).toEqual({ kind: 'ready' });
  });

  it('says the kept tree is locked, and waits, when it is sealed with no key here', () => {
    const view: ReturnType<typeof loaderView> = loaderView({ ...TIMED_OUT, reconnectingTo: 'acme.work.example.net', keptTreeLocked: true });
    expect(view).toEqual({ kind: 'spinner', message: expect.stringContaining(LOCKED_TREE_NOTICE), showConnectButton: false });
  });

  it('never opens on the kept tree while the link is up', () => {
    expect(loaderView({ ...TIMED_OUT, hasConnection: true, workspaceDataTimeout: true, keptTree: true }).kind).not.toBe('ready');
  });
});
