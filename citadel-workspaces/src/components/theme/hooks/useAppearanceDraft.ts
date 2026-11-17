/**
 * Draft lifecycle for the Workspace Appearance editor.
 *
 * Owns the editable copy of the workspace theme: seeding it from the saved
 * theme on open, previewing it app-wide while the modal is up, copy-on-edit of
 * presets, colour/selection changes, dirtiness, and the save flow. Split from
 * WorkspaceAppearanceModal.tsx so the modal is layout and the theme-editing
 * state machine lives here.
 */

import { useCallback, useEffect, useMemo, useState, useRef ,  type MutableRefObject } from 'react';
import { toast } from 'sonner';
import { useWorkspaceTheme } from '@/lib/theme/workspace-theme-context';
import { PRESET_THEMES } from '@/lib/theme/presets';
import { beginEdit, setToken } from '@/lib/theme/theme-editing';
import { PREVIEW_REGIONS , type PreviewRegion } from '@/lib/theme/preview-regions';
import type { WorkspaceTheme, ThemeTokenKey, ThemeMode, HslColor, ThemePalette } from '@/lib/theme/theme-types';
import { debugLog } from '@/lib/debug-config';
import type { Dispatch, SetStateAction } from 'react';

/**
 * What the colour wheel is pointed at. The workspace icon is not a palette
 * token, so this is a tagged union rather than a nullable token.
 */
export type Selection = { kind: 'token'; token: ThemeTokenKey } | { kind: 'icon' } | null;

interface UseAppearanceDraftParams {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (theme: WorkspaceTheme) => Promise<void>;
}

export function useAppearanceDraft({ open, onOpenChange, onSave }: UseAppearanceDraftParams): { draft: WorkspaceTheme; setDraft: Dispatch<SetStateAction<WorkspaceTheme>>; mode: ThemeMode; setMode: Dispatch<SetStateAction<ThemeMode>>; selection: Selection; setSelection: Dispatch<SetStateAction<Selection>>; selectedToken: keyof ThemePalette | null; saving: boolean; allThemes: WorkspaceTheme[]; palette: ThemePalette; activeRegion: PreviewRegion | null; editDraft: (change: (t: WorkspaceTheme) => WorkspaceTheme) => void; handleColorChange: (color: HslColor) => void; handleSave: () => Promise<void>; dirty: boolean; } {
  // savedTheme, NOT theme: `theme` becomes our own preview the moment we set
  // one, so comparing against it would make `dirty` permanently false.
  const { savedTheme, previewTheme } = useWorkspaceTheme();

  const [draft, setDraft] = useState<WorkspaceTheme>(savedTheme);
  const [mode, setMode] = useState<ThemeMode>('dark');
  /**
   * What the colour wheel is editing. The workspace icon is not a palette token,
   * so a plain token union cannot express it — hence a tagged selection rather
   * than a second piece of state that could disagree with the first.
   */
  const [selection, setSelection] = useState<Selection>(null);
  const selectedToken: keyof ThemePalette | null = selection?.kind === 'token' ? selection.token : null;
  const [saving, setSaving] = useState(false);

  // Reopening starts from whatever is saved, so an abandoned edit does not
  // resurrect itself the next time the modal opens.
  //
  // But NOT on every change of `savedTheme`'s reference. It is re-derived from
  // `state.workspace.metadata`, which is re-minted as a new object by every
  // `workspace:loaded` and by leader-to-follower state sync — so mid-edit the
  // colours snapped back to the saved theme and the selection cleared, with no
  // message and no way to recover the work. The admin tabs already carry this
  // dirty guard; this hook never got it.
  const seededForOpenRef: MutableRefObject<boolean> = useRef(false);
  const dirtyRef: MutableRefObject<boolean> = useRef(false);
  useEffect(() => {
    dirtyRef.current = draft !== savedTheme;
  }, [draft, savedTheme]);

  useEffect(() => {
    if (!open) {
      seededForOpenRef.current = false;
      return;
    }
    if (seededForOpenRef.current && dirtyRef.current) return;
    seededForOpenRef.current = true;
    setDraft(savedTheme);
    setSelection(null);
  }, [open, savedTheme]);

  // Preview the draft across the entire app while the modal is open, and hand
  // the app back its saved theme on close.
  useEffect(() => {
    previewTheme(open ? draft : null);
    return (): void => previewTheme(null);
  }, [open, draft, previewTheme]);

  const allThemes: WorkspaceTheme[] = useMemo(() => {
    // A custom draft is offered alongside the presets so it can be switched back
    // to after trying another one.
    const customs: WorkspaceTheme[] = draft.isPreset ? [] : [draft];
    return [...PRESET_THEMES, ...customs];
  }, [draft]);

  const palette: ThemePalette = mode === 'dark' ? draft.dark : draft.light;
  const activeRegion: PreviewRegion | null = selectedToken
    ? PREVIEW_REGIONS.find((r) => r.token === selectedToken) ?? null
    : null;

  const editDraft: (change: (t: WorkspaceTheme) => WorkspaceTheme) => void = useCallback(
    (change: (t: WorkspaceTheme) => WorkspaceTheme) => {
      setDraft((current) => {
        // Editing a preset copies it first, so presets stay pristine and
        // "put it back" is always available.
        const editable: WorkspaceTheme = beginEdit(current, allThemes.map((t) => t.name));
        return change(editable);
      });
    },
    [allThemes],
  );

  const handleColorChange: (color: HslColor) => void = useCallback(
    (color: HslColor) => {
      if (!selection) return;
      if (selection.kind === 'icon') {
        editDraft((t) => ({ ...t, icon: { ...t.icon, color } }));
        return;
      }
      editDraft((t) => setToken(t, mode, selection.token, color));
    },
    [editDraft, mode, selection],
  );

  const handleSave = async (): Promise<void> => {
    setSaving(true);
    try {
      await onSave(draft);
      toast.success('Workspace appearance updated', {
        description: 'Every member will see this theme.',
      });
      onOpenChange(false);
    } catch (error) {
      debugLog('WorkspaceAppearance', 'Failed to save theme', error);
      toast.error('Could not save appearance', {
        description: error instanceof Error ? error.message : 'Please try again.',
      });
    } finally {
      setSaving(false);
    }
  };

  const dirty: boolean = draft !== savedTheme;

  return {
    draft, setDraft,
    mode, setMode,
    selection, setSelection, selectedToken,
    saving,
    allThemes, palette, activeRegion,
    editDraft, handleColorChange, handleSave, dirty,
  };
}
