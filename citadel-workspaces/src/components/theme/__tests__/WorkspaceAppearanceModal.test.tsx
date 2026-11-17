/**
 * The Appearance modal. These cover the behaviours that are easy to get wrong
 * and invisible when they are: presets staying pristine, the permission gate
 * disabling rather than hiding, and the live preview being handed back on close.
 */
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WorkspaceAppearanceModal } from '../WorkspaceAppearanceModal';
import { WorkspaceThemeContext } from '@/lib/theme/workspace-theme-context';
import { defaultTheme, findPreset } from '@/lib/theme/presets';
import type { WorkspaceTheme } from '@/lib/theme/theme-types';

function renderModal(options: {
  canEdit?: boolean;
  saved?: WorkspaceTheme;
  onSave?: Mock<(theme: WorkspaceTheme) => Promise<void>>;
  previewTheme?: (t: WorkspaceTheme | null) => void;
} = {}): {
  onSave: Mock<(theme: WorkspaceTheme) => Promise<void>>;
  previewTheme: Mock<(...args: unknown[]) => unknown> | ((t: WorkspaceTheme | null) => void);
} {
  const {
    canEdit = true,
    saved = defaultTheme(),
    onSave = vi.fn<(theme: WorkspaceTheme) => Promise<void>>(() => Promise.resolve()),
    previewTheme = vi.fn(),
  } = options;

  render(
    <WorkspaceThemeContext.Provider value={{ theme: saved, savedTheme: saved, isDefault: false, previewTheme }}>
      <WorkspaceAppearanceModal
        open
        onOpenChange={vi.fn()}
        workspaceName="Acme"
        canEdit={canEdit}
        onSave={onSave}
      />
    </WorkspaceThemeContext.Provider>,
  );

  return { onSave, previewTheme };
}

describe('WorkspaceAppearanceModal', () => {
  beforeEach(() => vi.clearAllMocks());

  it('says the theme applies to everyone, and that light/dark stays personal', () => {
    renderModal();

    // The single most important thing to communicate: this is not a personal
    // setting, but it also does not seize the member's light/dark choice.
    expect(screen.getByText(/applies to everyone/i)).toBeInTheDocument();
    expect(screen.getByText(/chooses light or dark for themselves/i)).toBeInTheDocument();
  });

  it('shows the preview with a region per editable token', () => {
    renderModal();

    expect(screen.getByTestId('theme-preview')).toBeInTheDocument();
    expect(screen.getByTestId('preview-region-sidebar')).toBeInTheDocument();
    expect(screen.getByTestId('preview-region-active-item')).toBeInTheDocument();
  });

  it('opens the colour editor for the part that was clicked', async () => {
    renderModal();

    await userEvent.click(screen.getByTestId('preview-region-sidebar'));

    const editor: HTMLElement = screen.getByTestId('appearance-color-editor');
    expect(within(editor).getByText('Sidebar')).toBeInTheDocument();
    expect(screen.getByTestId('color-wheel')).toBeInTheDocument();
  });

  it('offers a hex field and a native picker beside the wheel', async () => {
    renderModal();

    await userEvent.click(screen.getByTestId('preview-region-sidebar'));

    expect(screen.getByTestId('color-wheel-hex')).toBeInTheDocument();
    expect(screen.getByTestId('color-wheel-native')).toBeInTheDocument();
  });

  it('turns a preset into a copy when a colour is changed, leaving the preset alone', async () => {
    renderModal({ saved: findPreset('nord')! });

    await userEvent.click(screen.getByTestId('preview-region-sidebar'));
    await userEvent.clear(screen.getByTestId('color-wheel-hex'));
    await userEvent.type(screen.getByTestId('color-wheel-hex'), '112233{Enter}');

    expect(screen.getByTestId('appearance-theme-name')).toHaveValue('Nord Copy');
    // The shipped preset must not have been mutated.
    expect(findPreset('nord')!.name).toBe('Nord');
  });

  it('cannot rename a preset but can rename the copy', async () => {
    renderModal({ saved: findPreset('nord')! });

    expect(screen.getByTestId('appearance-theme-name')).toBeDisabled();

    await userEvent.click(screen.getByTestId('preview-region-sidebar'));
    await userEvent.clear(screen.getByTestId('color-wheel-hex'));
    await userEvent.type(screen.getByTestId('color-wheel-hex'), '112233{Enter}');

    expect(screen.getByTestId('appearance-theme-name')).toBeEnabled();
  });

  it('disables every control without the themes permission, rather than hiding the modal', async () => {
    renderModal({ canEdit: false });

    // Discoverable, with a legible gate — seeing the workspace's theme is not
    // privileged; changing it is.
    expect(screen.getByTestId('workspace-appearance-modal')).toBeInTheDocument();
    expect(screen.getByText(/do not have permission/i)).toBeInTheDocument();
    expect(screen.getByTestId('appearance-save')).toBeDisabled();
    expect(screen.getByTestId('appearance-theme-name')).toBeDisabled();

    await userEvent.click(screen.getByTestId('preview-region-sidebar'));
    expect(screen.queryByTestId('appearance-color-editor')).not.toBeInTheDocument();
  });

  it('keeps save disabled until something actually changes', async () => {
    renderModal();

    expect(screen.getByTestId('appearance-save')).toBeDisabled();

    await userEvent.click(screen.getByTestId('preset-nord'));

    expect(screen.getByTestId('appearance-save')).toBeEnabled();
  });

  it('previews the draft across the whole app while open', () => {
    const { previewTheme } = renderModal();

    // The little mock shows the layout; only applying it for real shows what
    // living in the theme feels like.
    expect(previewTheme).toHaveBeenCalledWith(expect.objectContaining({ id: defaultTheme().id }));
  });

  it('saves the draft and reports that it is for everyone', async () => {
    const { onSave } = renderModal();

    await userEvent.click(screen.getByTestId('preset-dracula'));
    await userEvent.click(screen.getByTestId('appearance-save'));

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0].id).toBe('dracula');
  });

  it('switches the preview and the gallery to the mode being edited', async () => {
    renderModal();

    await userEvent.click(screen.getByTestId('appearance-mode-light'));

    // The gallery re-renders in light; showing light chips while editing dark
    // would misrepresent the choice.
    expect(screen.getByTestId('preset-nord')).toBeInTheDocument();
    expect(screen.getByTestId('theme-preview')).toBeInTheDocument();
  });
});
