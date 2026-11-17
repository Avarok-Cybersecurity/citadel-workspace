/** A failed sign-out shows its reason and a Retry that runs the sign-out again. */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DisconnectLoadingModal } from '../LoadingModalConfigs';

describe('the sign-out modal on an error', () => {
  it('names the failure and retries on request', () => {
    const onRetry: ReturnType<typeof vi.fn> = vi.fn();
    render(<DisconnectLoadingModal open status="error" workspaceName="w" errorMessage="Sign-out failed for alice" onRetry={onRetry} onCancel={() => undefined} />);
    expect(screen.getByText(/Sign-out failed for alice/)).toBeTruthy();
    fireEvent.click(screen.getByTestId('loading-modal-retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('offers no Retry when nothing failed', () => {
    render(<DisconnectLoadingModal open status="disconnecting" workspaceName="w" onRetry={() => undefined} />);
    expect(screen.queryByTestId('loading-modal-retry')).toBeNull();
  });
});
