/**
 * Deciding whether an office edit was saved, separately from doing it.
 *
 * This lived inside BaseOffice, tangled with MDX evaluation and a toast hook, so
 * the only way to exercise it was to render the whole editor. That is why its
 * two defects went unnoticed for so long:
 *
 *   - The write was inside `if (nodeId)` and the success toast was not, so with
 *     no nodeId nothing was persisted and the user was told it had been.
 *   - `setIsEditing(false)` ran outside the try/catch, so a FAILED save also
 *     closed the editor and discarded whatever had been typed — the work and the
 *     chance to retry it, both gone.
 *
 * The write and the notification are injected, which keeps the decision testable
 * without standing in for React or the MDX pipeline.
 */

export interface SaveOfficeNotice {
  kind: 'success' | 'error';
  title: string;
  description: string;
}

export interface SaveOfficeContentDeps {
  /** Absent when this page is no node -- there is nothing to write to. */
  nodeId?: string;
  /** Why, when there is no node: see edit-gate.ts. */
  noPageReason: string;
  content: string;
  /** Name to use in the confirmation; falls back to the page title. */
  displayName: string;
  write: (nodeId: string, content: string) => Promise<unknown>;
  notify: (notice: SaveOfficeNotice) => void;
  log: (message: string, error?: unknown) => void;
}

/**
 * Returns whether the content reached the server.
 *
 * The caller should leave edit mode only when this is true: on any other outcome
 * the user's text exists nowhere else yet.
 */
export async function saveOfficeContent(deps: SaveOfficeContentDeps): Promise<boolean> {
  const { nodeId, content, displayName, write, notify, log } = deps;

  if (!nodeId) {
    log('Refusing to save: no nodeId');
    // Said as it is. "This page is still loading" was the only answer, and it
    // was false on a page that had finished loading with no node behind it.
    notify({ kind: 'error', title: "Can't save this page", description: deps.noPageReason });
    return false;
  }

  try {
    await write(nodeId, content);
  } catch (error) {
    log('Failed to save MDX content', error);
    notify({
      kind: 'error',
      title: 'Error saving changes',
      description: 'There was a problem saving your changes. Please try again.',
    });
    return false;
  }

  notify({
    kind: 'success',
    title: 'Changes saved',
    description: `The ${displayName} page has been updated`,
  });
  return true;
}
