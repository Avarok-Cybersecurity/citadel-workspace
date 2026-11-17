/**
 * A hook that subscribes must unsubscribe, and these three did not.
 *
 * `workspaceEvents.onMemberEvent`, `onWorkspaceEvent` and `onNodeEvent` return
 * their unsubscribe SYNCHRONOUSLY. `useMemberEventSetup`,
 * `useWorkspaceEventSetup` and `useNodeEventSetup` captured none of them, and
 * their effects returned no cleanup — so every remount
 * left another set of live listeners behind, each retaining a closure over
 * `setState`, and every event afterwards ran an ever-growing pile of dead
 * handlers.
 *
 * Nothing broke visibly, because setState on an unmounted component is a no-op.
 * That is exactly why it accumulated. `use-domain-members` carries the same
 * paragraph about the same mistake — fixed there, and not here.
 *
 * The sibling `useMessageEventSetup` calls `cleanupAllListeners()` on unmount,
 * which does remove these — and every listener this hook never created. Owning
 * your own unsubscribe is not the same as somebody else clearing the room.
 *
 * The table below is the point: the first pass fixed two of the three, which is
 * the house's most productive defect class -- a correct fix applied in one
 * place. Every sibling is listed here so the next one added has to join it.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { eventEmitter } from '@/lib/event-emitter';
import { WORKSPACE_ROOT_ID } from '@/lib/workspace-constants';
import { useMemberEventSetup } from '../useMemberEventSetup';
import { useWorkspaceEventSetup } from '../useWorkspaceEventSetup';
import { useNodeEventSetup } from '../useNodeEventSetup';

vi.mock('@/lib/workspace-service', () => ({
  default: { listMembers: vi.fn(async () => {}) },
}));

/**
 * How many of the hook's handlers for `event` are still live.
 *
 * Counted through `setState`, which every one of them calls -- the first version
 * of this counted its own probe's invocations, so it returned 1 whatever the
 * hook had done and both tests were measuring nothing.
 */
function liveHandlers(setState: ReturnType<typeof vi.fn>, event: string, payload: unknown): number {
  setState.mockClear();
  eventEmitter.emit(event, payload);
  return setState.mock.calls.length;
}

interface EventSetup {
  readonly name: string;
  readonly use: (props: { setState: ReturnType<typeof vi.fn> }) => void;
  readonly event: string;
  readonly payload: unknown;
}

const SETUPS: readonly EventSetup[] = [
  {
    name: 'useMemberEventSetup',
    use: useMemberEventSetup,
    event: 'members:loaded',
    // WORKSPACE_ROOT_ID, not an arbitrary id. `liveHandlers` counts by EMITTING
    // the event and watching `setState`, so a payload this subscriber legitimately
    // filters out reads as "no live handler" -- which is what happened when the
    // is-for-domain guard was added here: both tests failed with "expected 0 to
    // be greater than 0", their own positive control reporting a leak-check that
    // could no longer see the handler rather than a handler that had gone.
    //
    // The probe must be a message the subscriber accepts, or a liveness test
    // becomes a test of the filter.
    payload: { members: [], domainId: WORKSPACE_ROOT_ID, connection: {} },
  },
  {
    name: 'useWorkspaceEventSetup',
    use: useWorkspaceEventSetup,
    event: 'workspace:loading',
    payload: {},
  },
  {
    name: 'useNodeEventSetup',
    use: useNodeEventSetup,
    event: 'nodes:loading',
    payload: {},
  },
];

describe.each(SETUPS)('$name', ({ use, event, payload }: EventSetup) => {
  it('leaves no listener behind when it unmounts', async () => {
    const setState: ReturnType<typeof vi.fn> = vi.fn();
    const { unmount } = renderHook(() => use({ setState }));
    await new Promise((resolve): void => { setTimeout(resolve, 20); });
    const mounted: number = liveHandlers(setState, event, payload);

    unmount();
    await new Promise((resolve): void => { setTimeout(resolve, 20); });
    const after: number = liveHandlers(setState, event, payload);

    // `mounted` is the positive control: if the hook never subscribed at all,
    // "nothing left behind" would be trivially true and mean nothing.
    expect(mounted).toBeGreaterThan(0);
    expect(after).toBe(0);
  });

  it('does not accumulate across remounts', async () => {
    // The shape of the leak: these hooks live in AppLayout, which remounts on
    // every route change.
    const setState: ReturnType<typeof vi.fn> = vi.fn();

    const first: ReturnType<typeof renderHook> = renderHook(() => use({ setState }));
    await new Promise((resolve): void => { setTimeout(resolve, 20); });
    const oneMount: number = liveHandlers(setState, event, payload);
    first.unmount();

    const second: ReturnType<typeof renderHook> = renderHook(() => use({ setState }));
    await new Promise((resolve): void => { setTimeout(resolve, 20); });
    const remounted: number = liveHandlers(setState, event, payload);
    second.unmount();

    expect(oneMount).toBeGreaterThan(0);
    expect(remounted).toBe(oneMount);
  });
});
