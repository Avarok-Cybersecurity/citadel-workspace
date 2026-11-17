/**
 * Dismissing the connection-retry dialog has to mean something.
 *
 * `connection-failure` is emitted every time the WASM client fails to open its
 * socket, and it retries while the agent is down — so the dialog reopened
 * within a second or two of every dismissal, indefinitely. Measured against a
 * build pointed at a dead port: Escape closes it, and it is back before the
 * next check.
 *
 * `WorkspaceApp` already reached this conclusion for the other half of the same
 * condition, suppressing the dialog while the browser reports no network:
 * "two notices for one condition, and the blocking one adds nothing… counting
 * down retries that cannot succeed". The agent being down is that situation
 * with a different cause, and the offline banner has an agent-down state saying
 * so across the top of the app.
 */
import { describe, it, expect } from 'vitest';
import type { RetryVisibility } from '@/components/hooks/connection-retry-visibility';
import {
  NOT_FAILING, onFailure, onDismiss, onSuccess, isRetryDialogOpen,
} from '../connection-retry-visibility';

describe('the connection retry dialog', () => {
  it('opens on the first failure', () => {
    expect(isRetryDialogOpen(onFailure(NOT_FAILING))).toBe(true);
  });

  it('stays shut through the failures that follow a dismissal', () => {
    // The defect, stated directly: with the agent down this loop ran every
    // couple of seconds and each turn put the dialog back.
    let state: RetryVisibility = onDismiss(onFailure(NOT_FAILING));
    for (let i: number = 0; i < 20; i += 1) state = onFailure(state);
    expect(isRetryDialogOpen(state)).toBe(false);
  });

  it('interrupts again after a connection succeeds', () => {
    // The positive control. A dismissal that survived a recovery would silence
    // the dialog for the rest of the session, which is the opposite bug and
    // just as bad: the user would never be told about a NEW outage.
    const dismissed: RetryVisibility = onDismiss(onFailure(NOT_FAILING));
    const recovered: RetryVisibility = onSuccess();
    expect(isRetryDialogOpen(onFailure(recovered))).toBe(true);
    expect(isRetryDialogOpen(dismissed)).toBe(false);
  });

  it('is shut when nothing has failed', () => {
    expect(isRetryDialogOpen(NOT_FAILING)).toBe(false);
  });

  it('does not reopen merely because a success arrived', () => {
    // Success clears the failure too; a "recovered" state must not render an
    // empty dialog.
    expect(isRetryDialogOpen(onSuccess())).toBe(false);
  });
});
