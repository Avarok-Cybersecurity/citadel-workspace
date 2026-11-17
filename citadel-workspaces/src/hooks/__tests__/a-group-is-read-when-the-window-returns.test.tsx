/**
 * Messages that arrived while the window was behind another are read when it
 * comes back to the open group; a window that is still behind reads nothing.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

const front: { value: boolean } = vi.hoisted((): { value: boolean } => ({ value: false }));
vi.mock('@/lib/agent-conversations/report-focus', () => ({
  windowInFront: (): boolean => front.value,
}));

import { useReadWhenInFront } from '../use-read-when-in-front';

describe('useReadWhenInFront', () => {
  it('marks the group read when focus returns to a window in front', () => {
    const markRead: (id: string) => void = vi.fn();
    renderHook(() => useReadWhenInFront('g1', markRead));
    front.value = false;
    window.dispatchEvent(new Event('focus'));
    expect(markRead).not.toHaveBeenCalled();
    front.value = true;
    window.dispatchEvent(new Event('focus'));
    expect(markRead).toHaveBeenCalledWith('g1');
  });

  it('stops listening on unmount', () => {
    const markRead: (id: string) => void = vi.fn();
    const { unmount } = renderHook(() => useReadWhenInFront('g1', markRead));
    unmount();
    front.value = true;
    window.dispatchEvent(new Event('focus'));
    expect(markRead).not.toHaveBeenCalled();
  });
});
