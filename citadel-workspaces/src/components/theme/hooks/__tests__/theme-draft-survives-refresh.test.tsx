/**
 * The reseed effect ran on every change of `savedTheme`'s REFERENCE. That value
 * is re-derived from `state.workspace.metadata`, which is re-minted as a new
 * object by every `workspace:loaded` and by leader-to-follower state sync — so
 * mid-edit the colours snapped back to the saved theme and the selection
 * cleared, with no message and no way to recover the work.
 *
 * The admin tabs already carry this dirty guard; this hook never got it.
 */
import { describe, it, expect, vi  } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const themeRef: { current: Record<string, string>; } = { current: { primary: 'blue' } as Record<string, string> };
const previewTheme: ReturnType<typeof vi.fn> = vi.fn();

vi.mock('@/lib/theme/workspace-theme-context', () => ({
  useWorkspaceTheme: (): { savedTheme: Record<string, string>; previewTheme: ReturnType<typeof vi.fn> } =>
    ({ savedTheme: themeRef.current, previewTheme }),
}));

import { useAppearanceDraft } from '../useAppearanceDraft';

const params: { open: boolean; onOpenChange: ReturnType<typeof vi.fn>; onSave: ReturnType<typeof vi.fn> } = { open: true, onOpenChange: vi.fn(), onSave: vi.fn() };

describe('useAppearanceDraft', () => {
  it('keeps an unsaved edit when the workspace object is re-minted', () => {
    themeRef.current = { primary: 'blue' };
    const { result, rerender } = renderHook(() => useAppearanceDraft(params));

    act(() => result.current.setDraft({ primary: 'crimson' } as never));
    expect(result.current.draft).toMatchObject({ primary: 'crimson' });

    // Identical CONTENT, new object identity — exactly what a workspace:loaded
    // or a follower state sync produces.
    themeRef.current = { primary: 'blue' };
    rerender();

    expect(
      result.current.draft,
      'an unsaved theme edit was replaced by a workspace refresh',
    ).toMatchObject({ primary: 'crimson' });
  });

  it('still starts from the saved theme when the modal is reopened', () => {
    themeRef.current = { primary: 'blue' };
    const { result, rerender } = renderHook(
      ({ open }) => useAppearanceDraft({ ...params, open }),
      { initialProps: { open: true } },
    );

    act(() => result.current.setDraft({ primary: 'crimson' } as never));

    rerender({ open: false });
    rerender({ open: true });

    // An abandoned edit must not resurrect itself.
    expect(result.current.draft).toMatchObject({ primary: 'blue' });
  });
});
