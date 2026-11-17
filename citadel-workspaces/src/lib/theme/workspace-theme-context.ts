import { createContext, useContext , type Context } from 'react';
import type { WorkspaceTheme } from './theme-types';
import { defaultTheme } from './presets';

export interface WorkspaceThemeContextValue {
  /**
   * The theme currently applied to the document — the PREVIEW while one is
   * active, otherwise the saved one. This is what the app should render from.
   */
  theme: WorkspaceTheme;
  /**
   * The theme actually persisted for this workspace, ignoring any preview.
   *
   * Distinct from `theme` because an editor previewing its own draft would
   * otherwise compare the draft against itself: every edit would update the
   * baseline, "has anything changed" would always be false, and Save would never
   * enable. Two different facts, two names.
   */
  savedTheme: WorkspaceTheme;
  /**
   * True while the workspace has said nothing about its theme, so the default is
   * standing in. Lets the editor show "not yet set" rather than implying the
   * workspace chose Avarok Purple.
   */
  isDefault: boolean;
  /**
   * Preview a theme without persisting it, so the editor can update the whole
   * app live as a colour is dragged. Passing null returns to the saved theme.
   */
  previewTheme: (theme: WorkspaceTheme | null) => void;
}

export const WorkspaceThemeContext: Context<WorkspaceThemeContextValue> = createContext<WorkspaceThemeContextValue>({
  theme: defaultTheme(),
  savedTheme: defaultTheme(),
  isDefault: true,
  previewTheme: () => {
    // A no-op default rather than a throw: components that read the theme are
    // rendered in tests and stories without the provider, and refusing to render
    // there would be worse than simply not previewing.
  },
});

export function useWorkspaceTheme(): WorkspaceThemeContextValue {
  return useContext(WorkspaceThemeContext);
}
