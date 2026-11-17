/**
 * The protocol-warning banner has never rendered, because nothing emits
 * `protocol:warning`. Three of the chain's four links exist: this banner, the
 * listener in `useMessageEventSetup` that writes `state.protocolWarning`, and
 * the payload type.
 *
 * The dead-listener list explained the missing producer by saying the banner
 * "is driven by its own component state". It is not — it is driven by state
 * only that dead listener writes — and a wrong reason in a debt list is what
 * stops the next reader from checking.
 *
 * A producer is not being invented here: the obvious one, the response
 * handler's "unhandled variant" branch, is the normal path for every write an
 * awaiting caller matches through `workspace:raw-response`, and a banner on
 * ordinary success teaches people to ignore banners.
 *
 * What this does is make the last link known-good, so whoever finds the right
 * producer inherits a display that works rather than one nobody has ever seen.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WorkspaceContext } from '@/contexts/WorkspaceContext';
import { ProtocolWarning } from '../protocol-warning';
import type { WorkspaceState } from '@/contexts/WorkspaceContext';

function withState(state: Partial<WorkspaceState>): ReturnType<typeof render> {
  return render(
    <WorkspaceContext.Provider
      value={{ state: state as WorkspaceState, dispatch: (): void => {} } as never}
    >
      <ProtocolWarning />
    </WorkspaceContext.Provider>,
  );
}

describe('the protocol warning banner', () => {
  it('shows the message and the request type it was given', () => {
    withState({
      protocolWarning: { message: 'Server sent an unknown frame', requestType: 'ListNodes', timestamp: 1 },
    });

    expect(screen.getByText(/unknown frame/i)).toBeTruthy();
    // The request type is the actionable half: a warning with no subject is a
    // warning nobody can act on.
    expect(screen.getByText(/ListNodes/)).toBeTruthy();
  });

  it('shows nothing when there is no warning', () => {
    // The positive control: a banner that rendered unconditionally would
    // satisfy the test above and sit on screen for the life of the app.
    const { container } = withState({});
    expect(container.textContent).toBe('');
  });
});
