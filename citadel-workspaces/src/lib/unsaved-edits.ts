/**
 * Whether anything on screen has unsaved changes.
 *
 * `use-unsaved-mdx-guard` arms `beforeunload`, which covers closing the tab and
 * nothing else — its own footer comment refers to "any future navigation
 * guard". In-app navigation therefore threw the buffer away silently: one click
 * on a sidebar node unmounts the editor (BaseOffice is keyed by node), and the
 * user's work is gone with no prompt.
 *
 * A router-level blocker (`useBlocker`) would cover every path at once, but it
 * requires a data router and this app mounts `<BrowserRouter>`. Until that
 * migration, navigation sources consult this before leaving. The store is here
 * rather than in the guard so the sources do not import editor internals, and so
 * there is one answer to "is anything dirty" rather than one per surface.
 *
 * Known gap, deliberately: browser Back/Forward is a popstate, which neither
 * `beforeunload` nor a call-site check can intercept. That one needs the data
 * router.
 */
import { holdReload } from '@/lib/pwa/reload-safety';

const dirty: Set<string> = new Set<string>();

/** Mark an editor dirty. Returns a function that clears it. Dirty, it also holds reloads. */
export function registerUnsavedEdits(ownerId: string): () => void {
  dirty.add(ownerId);
  const releaseReload: () => void = holdReload('unsaved edit');
  return () => {
    dirty.delete(ownerId);
    releaseReload();
  };
}

export function hasUnsavedEdits(): boolean {
  return dirty.size > 0;
}

/** Test seam. */
export function clearUnsavedEditsForTests(): void {
  dirty.clear();
}
