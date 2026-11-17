/**
 * Lowering the loading flag is not the same as learning the workspace is empty.
 *
 * `listNodes` resolves when the request is SENT, so `loading.nodes` would stay
 * raised forever if the response never came. `loading-flag-timeout` lowers it
 * after 15s, and its docstring calls the empty state "the honest fallback".
 *
 * For the tree that is not honest: it renders "Your workspace is empty. Click
 * the + button to create your first space", and following that advice creates a
 * duplicate space in a workspace whose contents merely did not arrive. The
 * deadline therefore has to record WHY the flag went down.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { eventEmitter } from '@/lib/event-emitter';
import { LOADING_DEADLINE_MS } from '@/lib/loading-flag-timeout';
import { useNodeEventSetup } from '../useNodeEventSetup';
import type { WorkspaceEventState } from '../../WorkspaceEventHandler';

function harness(): { state: () => Partial<WorkspaceEventState> } {
  let current: Partial<WorkspaceEventState> = {
    nodes: {}, loading: { workspace: false, members: false, nodes: false }, nodesUnavailable: false,
  };
  const setState = (update: unknown): void => {
    current = typeof update === 'function'
      ? (update as (p: Partial<WorkspaceEventState>) => Partial<WorkspaceEventState>)(current)
      : (update as Partial<WorkspaceEventState>);
  };
  renderHook(() => useNodeEventSetup({ setState: setState as never }));
  return { state: (): Partial<WorkspaceEventState> => current };
}

describe('the node list deadline', () => {
  beforeEach((): void => { vi.useFakeTimers(); });
  afterEach((): void => { vi.useRealTimers(); });

  it('records that nothing arrived, rather than only lowering the flag', () => {
    const h: ReturnType<typeof harness> = harness();

    act((): void => { eventEmitter.emit('nodes:loading', {}); });
    expect(h.state().loading?.nodes).toBe(true);
    // Nothing has failed yet: a raised flag is not a failure.
    expect(h.state().nodesUnavailable).toBe(false);

    act((): void => { vi.advanceTimersByTime(LOADING_DEADLINE_MS + 100); });

    expect(h.state().loading?.nodes).toBe(false);
    expect(h.state().nodesUnavailable).toBe(true);
  });

  it('takes it back when an answer does arrive', () => {
    // The positive control: a version that set the flag and never cleared it
    // would pass the test above and then call every later load a failure.
    const h: ReturnType<typeof harness> = harness();

    act((): void => { eventEmitter.emit('nodes:loading', {}); });
    act((): void => { vi.advanceTimersByTime(LOADING_DEADLINE_MS + 100); });
    expect(h.state().nodesUnavailable).toBe(true);

    act((): void => {
      eventEmitter.emit('nodes:loaded', { nodes: [], connection: {} });
    });
    expect(h.state().nodesUnavailable).toBe(false);
  });
});
