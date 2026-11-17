/**
 * Copy buttons that logged a refused write and stopped left the person pasting stale text. The hook
 * says it worked (a flag the control shows) or that it did not (a toast).
 *
 * Real: the hook, the toast hook and Sonner. The clipboard is the browser's, so it is the one double,
 * and it is exactly what varies: allowed or refused.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Toaster } from '@/components/ui/sonner';
import { useCopyToClipboard } from '../use-copy-to-clipboard';

function Button(): JSX.Element {
  const { copied, copy } = useCopyToClipboard();
  return <button type="button" onClick={(): void => { void copy('secret'); }}>{copied ? 'Copied' : 'Copy'}</button>;
}

function clipboard(write: () => Promise<void>): void {
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn(write) }, configurable: true });
}

afterEach((): void => { vi.restoreAllMocks(); });

describe('copying', () => {
  it('shows that it worked', async () => {
    clipboard(async () => undefined);
    render(<><Toaster /><Button /></>);
    fireEvent.click(screen.getByText('Copy'));
    expect(await screen.findByText('Copied')).toBeTruthy();
  });

  it('says so when the browser refuses, and does not show a tick', async () => {
    clipboard(async () => { throw new Error('denied'); });
    render(<><Toaster /><Button /></>);
    fireEvent.click(screen.getByText('Copy'));
    expect(await screen.findByText('Could not copy')).toBeTruthy();
    await waitFor(() => expect(screen.queryByText('Copied')).toBeNull());
  });
});
