/**
 * On a phone, toasts must not come from the bottom.
 *
 * Measured at 375px: the "Ready to work offline" toast occupied 559–651px and
 * the join form's submit button 572–607px, so `document.elementFromPoint` at the
 * centre of "Join" returned the toast. The last button of first-run registration
 * could not be pressed while an ambient notice was up — and nothing failed. The
 * button was present, visible, enabled, correctly named and above the tap-size
 * floor. Only a hit test sees it.
 *
 * `check-mobile-layout.mjs` now hit-tests every control, which catches this
 * class in general — but only while a toast happens to be on screen, and the
 * ambient ones fire on a schedule no gate can force. So the arrangement itself
 * is asserted here: bottom on a desktop, where a toast lands in empty margin;
 * top on a phone, where there is no margin and the primary action is at the
 * bottom of the form.
 */
import { describe, it, expect, vi, afterEach  } from 'vitest';
import { render, cleanup, act, waitFor } from '@testing-library/react';
import { toast } from 'sonner';
import { Toaster } from '../sonner';

vi.mock('next-themes', (): { useTheme: () => { theme: string; }; } => ({ useTheme: (): { theme: string; } => ({ theme: 'light' }) }));

const isMobile: ReturnType<typeof vi.fn> = vi.fn();
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: (): unknown => isMobile() }));

afterEach(cleanup);

/**
 * Sonner renders the positioned list only once it holds a toast, so every case
 * raises one first. Without that the container is absent and the assertion below
 * reads `null` — a check over nothing, which is how the first version of this
 * test failed three ways at once.
 */
async function yPositionWithAToast(): Promise<string | null> {
  act(() => { toast('probe'); });
  await waitFor(() => expect(document.querySelector('[data-sonner-toaster]')).not.toBeNull());
  return document.querySelector('[data-sonner-toaster]')?.getAttribute('data-y-position') ?? null;
}

describe('the toaster', () => {
  it('comes from the top on a phone, clear of the submit button', async () => {
    isMobile.mockReturnValue(true);
    render(<Toaster />);
    expect(await yPositionWithAToast()).toBe('top');
  });

  it('still comes from the bottom on a desktop', async () => {
    isMobile.mockReturnValue(false);
    render(<Toaster />);
    expect(await yPositionWithAToast()).toBe('bottom');
  });

  it('reads the viewport rather than assuming one', async () => {
    // Both branches must come from the same component, or this is two
    // hard-coded constants agreeing with themselves.
    isMobile.mockReturnValue(true);
    render(<Toaster />);
    const phone: string | null = await yPositionWithAToast();
    cleanup();
    toast.dismiss();
    isMobile.mockReturnValue(false);
    render(<Toaster />);
    expect(phone).not.toBe(await yPositionWithAToast());
  });
});
