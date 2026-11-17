import { cn } from '@/lib/utils';
import { Check } from 'lucide-react';
import type { WorkspaceTheme, ThemeMode, ThemePalette } from '@/lib/theme/theme-types';
import { toCssColor } from '@/lib/theme/hsl';

interface PresetGalleryProps {
  themes: WorkspaceTheme[];
  selectedId: string;
  mode: ThemeMode;
  onSelect: (theme: WorkspaceTheme) => void;
}

/**
 * The theme chooser.
 *
 * Each entry shows the palette itself rather than a name and a single swatch —
 * "Nord" means nothing to someone who has not used it, but four colours in the
 * proportions they will appear in is immediately legible.
 *
 * Rendered in the mode being edited, so switching to dark re-renders every
 * card in its dark palette. Showing light chips while editing dark would
 * misrepresent the choice.
 */
export function PresetGallery({ themes, selectedId, mode, onSelect }: PresetGalleryProps): JSX.Element {
  return (
    <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Theme">
      {themes.map((theme) => {
        const palette: ThemePalette = mode === 'dark' ? theme.dark : theme.light;
        const selected: boolean = theme.id === selectedId;

        return (
          <button
            key={theme.id}
            type="button"
            role="radio"
            aria-checked={selected}
            data-testid={`preset-${theme.id}`}
            data-selected={selected ? 'true' : undefined}
            onClick={() => onSelect(theme)}
            className={cn(
              'group relative overflow-hidden rounded-lg border p-2 text-left transition-transform duration-150',
              'motion-safe:hover:scale-[0.98] motion-safe:active:scale-[0.96]',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              selected ? 'border-primary ring-1 ring-primary' : 'border-border hover:border-primary/50',
            )}
            style={{ backgroundColor: toCssColor(palette.background) }}
          >
            <span className="mb-2 flex gap-1">
              <Chip color={toCssColor(palette.primary)} />
              <Chip color={toCssColor(palette.primaryAccent)} />
              <Chip color={toCssColor(palette.surface)} />
              <Chip color={toCssColor(palette.border)} />
            </span>

            <span className="flex items-center gap-1">
              <span
                className="truncate text-xs font-medium"
                style={{ color: toCssColor(palette.foreground) }}
              >
                {theme.name}
              </span>
              {selected && (
                <Check className="ml-auto h-3.5 w-3.5 shrink-0" style={{ color: toCssColor(palette.primaryAccent) }} />
              )}
            </span>

            {!theme.isPreset && (
              <span className="mt-0.5 block text-xs" style={{ color: toCssColor(palette.mutedForeground) }}>
                Custom
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function Chip({ color }: { color: string }): JSX.Element {
  return <span className="h-4 w-4 rounded-full" style={{ backgroundColor: color }} />;
}
