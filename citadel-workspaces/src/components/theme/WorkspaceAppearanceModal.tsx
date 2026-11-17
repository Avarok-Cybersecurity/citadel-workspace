import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ThemePreview } from './ThemePreview';
import { ColorWheel } from './ColorWheel';
import { PresetGallery } from './PresetGallery';
import { PaletteModeToggle } from './PaletteModeToggle';
import { useAppearanceDraft } from './hooks/useAppearanceDraft';
import { renameTheme, canRename, resetDarkToDerived } from '@/lib/theme/theme-editing';
import { toCssColor } from '@/lib/theme/hsl';
import type { WorkspaceTheme } from '@/lib/theme/theme-types';

interface WorkspaceAppearanceModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceName: string;
  /** False when the viewer lacks the `themes` permission; the editor becomes read-only. */
  canEdit: boolean;
  onSave: (theme: WorkspaceTheme) => Promise<void>;
}

/**
 * Workspace Appearance.
 *
 * The theme set here is the workspace's and applies to every member, which is
 * why it needs its own permission. A member without it still sees the modal —
 * seeing which theme the workspace uses is not privileged — but every control is
 * disabled rather than hidden, so the feature is discoverable and its gate is
 * legible.
 *
 * Editing previews live against the whole app, not just the little mock: the
 * preview shows the layout, but only applying the theme for real shows what
 * living in it feels like. Closing without saving restores the saved theme.
 */
export function WorkspaceAppearanceModal({
  open,
  onOpenChange,
  workspaceName,
  canEdit,
  onSave,
}: WorkspaceAppearanceModalProps): JSX.Element {
  const {
    draft, setDraft,
    mode, setMode,
    selection, setSelection, selectedToken,
    saving,
    allThemes, palette, activeRegion,
    editDraft, handleColorChange, handleSave, dirty,
  } = useAppearanceDraft({ open, onOpenChange, onSave });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Rows, so only the middle scrolls: the header says what this is and the
          footer is the way out, and both must stay put. Letting the whole
          dialog scroll instead means the actions are reachable but only after
          scrolling past a colour wheel, which on a phone reads as no actions at
          all. minmax(0,1fr) is what actually lets the middle row shrink —
          without it the grid floors at content height and overflows anyway. */}
      <DialogContent
        className="grid max-h-[calc(100dvh-2rem)] max-w-3xl grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden"
        data-testid="workspace-appearance-modal"
      >
        <DialogHeader>
          <DialogTitle>Workspace Appearance</DialogTitle>
          <DialogDescription>
            {canEdit
              ? 'This theme applies to everyone in the workspace. Each member still chooses light or dark for themselves.'
              : 'You do not have permission to change the workspace theme.'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-5 overflow-y-auto md:grid-cols-[1fr_220px]">
          <div className="space-y-4">
            <PaletteModeToggle
              mode={mode}
              onModeChange={setMode}
              showRederive={mode === 'dark' && !draft.darkIsDerived && canEdit}
              onRederive={() => editDraft(resetDarkToDerived)}
            />

            {/* Clicking a part of the mock selects the token it paints. */}
            <ThemePreview
              palette={palette}
              icon={draft.icon}
              radius={draft.radius}
              workspaceName={workspaceName}
              selectedToken={selectedToken}
              onSelectToken={canEdit ? (token): void => setSelection({ kind: 'token', token }) : (): undefined => undefined}
            />

            <div className="space-y-2">
              <Label htmlFor="theme-name">Theme name</Label>
              <Input
                id="theme-name"
                data-testid="appearance-theme-name"
                value={draft.name}
                disabled={!canEdit || (draft.isPreset && !canRename(draft))}
                onChange={(e) =>
                  setDraft((current) =>
                    canRename(current)
                      ? renameTheme(current, e.target.value, allThemes.map((t) => t.name))
                      : current,
                  )
                }
              />
              {draft.isPreset && (
                <p className="text-xs text-muted-foreground">
                  Presets keep their name. Changing a colour creates your own copy, which you can rename.
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="workspace-icon">Workspace icon</Label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  data-testid="appearance-icon-color"
                  aria-label="Change the workspace icon colour"
                  disabled={!canEdit}
                  onClick={() => setSelection({ kind: 'icon' })}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-sm font-semibold transition-transform duration-150 motion-safe:hover:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                  style={{
                    backgroundColor: toCssColor(draft.icon.color),
                    color: toCssColor(palette.primaryForeground),
                  }}
                >
                  {draft.icon.emoji ?? workspaceName.slice(0, 1).toUpperCase()}
                </button>
                <Input
                  id="workspace-icon"
                  data-testid="appearance-icon-emoji"
                  placeholder="Emoji (optional)"
                  value={draft.icon.emoji ?? ''}
                  disabled={!canEdit}
                  onChange={(e) => {
                    // One emoji, taken by code point so a multi-byte glyph is not
                    // sliced in half into an unrenderable fragment.
                    const first: string = [...e.target.value.trim()][0];
                    editDraft((t) => ({
                      ...t,
                      icon: { ...t.icon, emoji: first || undefined },
                    }));
                  }}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Shown in the workspace switcher. Without an emoji it uses the workspace initial.
              </p>
            </div>
          </div>

          <div className="space-y-4">
            {canEdit && selection ? (
              <div className="space-y-2" data-testid="appearance-color-editor">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {selection.kind === 'icon' ? 'Workspace icon' : activeRegion?.label}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {selection.kind === 'icon'
                      ? 'The colour behind the workspace icon in the switcher and sidebar.'
                      : activeRegion?.description}
                  </p>
                </div>
                <ColorWheel
                  label={selection.kind === 'icon' ? 'Workspace icon' : activeRegion?.label ?? 'Colour'}
                  value={selection.kind === 'icon' ? draft.icon.color : palette[selection.token]}
                  onChange={handleColorChange}
                />
                <Button variant="ghost" size="sm" className="w-full" onClick={() => setSelection(null)}>
                  Done
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                <Label>Presets</Label>
                <PresetGallery
                  themes={allThemes}
                  selectedId={draft.id}
                  mode={mode}
                  onSelect={(t) => canEdit && setDraft(t)}
                />
                {canEdit && (
                  <p className="text-xs text-muted-foreground">
                    Click any part of the preview to change its colour.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button
            data-testid="appearance-save"
            onClick={handleSave}
            disabled={!canEdit || !dirty || saving}
          >
            {saving ? 'Saving…' : 'Save for everyone'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
