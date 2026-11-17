import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTheme } from 'next-themes';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { WorkspaceThemeContext } from '@/lib/theme/workspace-theme-context';
import { deserializeTheme } from '@/lib/theme/theme-serialization';
import { applyTheme, clearTheme } from '@/lib/theme/apply-theme';
import { defaultTheme } from '@/lib/theme/presets';
import type { WorkspaceTheme } from '@/lib/theme/theme-types';
import { debugLog } from '@/lib/debug-config';
import type { WorkspaceMetadataBytes } from '@/types/workspace-metadata';

/**
 * Applies the workspace's theme to the document.
 *
 * Two independent inputs decide what the user sees:
 *
 *  - the WORKSPACE theme, which an authorised member sets for everyone. It
 *    arrives in the workspace's metadata bytes, so every member gets it with
 *    the workspace they already load — no extra request, no separate sync.
 *  - the USER's light / dark / system preference, which is theirs alone and is
 *    owned by next-themes. Nothing here writes it.
 *
 * The workspace picks the palette; the user picks which half of it applies.
 * Conflating the two is the obvious mistake — it would let an admin force
 * everyone into dark mode, or let a user's preference silently override the
 * workspace's colours.
 */
export function WorkspaceThemeProvider({ children }: { children: ReactNode }): JSX.Element {
  const { state } = useWorkspace();
  const { resolvedTheme } = useTheme();

  /** Set while the editor is previewing; takes precedence over the saved theme. */
  const [preview, setPreview] = useState<WorkspaceTheme | null>(null);

  const saved: WorkspaceTheme | null = useMemo((): WorkspaceTheme | null => {
    const metadata: WorkspaceMetadataBytes | undefined = state.workspace?.metadata;
    if (!metadata) return null;

    // deserializeTheme returns null for anything that is not a theme envelope,
    // because metadata is a general-purpose field other features also write to.
    const parsed: WorkspaceTheme | null = deserializeTheme(metadata);
    if (!parsed) {
      debugLog('WorkspaceTheme', 'Workspace metadata carries no usable theme; using the default');
    }
    return parsed;
  }, [state.workspace?.metadata]);

  const theme: WorkspaceTheme = preview ?? saved ?? defaultTheme();
  const mode: "light" | "dark" = resolvedTheme === 'light' ? 'light' : 'dark';

  useEffect(() => {
    applyTheme(theme, mode);
  }, [theme, mode]);

  useEffect(() => {
    // Leaving the workspace must drop its variables, or the next workspace
    // inherits whichever tokens it does not itself set.
    return (): void => clearTheme();
  }, []);

  const previewTheme: (next: WorkspaceTheme | null) => void = useCallback((next: WorkspaceTheme | null): void => setPreview(next), []);

  const value: { theme: WorkspaceTheme; savedTheme: WorkspaceTheme; isDefault: boolean; previewTheme: (next: WorkspaceTheme | null) => void; } = useMemo(
    () => ({
      theme,
      // Never the preview: this is the baseline an editor compares against.
      savedTheme: saved ?? defaultTheme(),
      isDefault: saved === null && preview === null,
      previewTheme,
    }),
    [theme, saved, preview, previewTheme],
  );

  return <WorkspaceThemeContext.Provider value={value}>{children}</WorkspaceThemeContext.Provider>;
}
