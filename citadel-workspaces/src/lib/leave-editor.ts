/**
 * Asking before a navigation throws away an editor buffer.
 *
 * `use-unsaved-mdx-guard` arms `beforeunload`, which covers closing the tab and
 * nothing else. In-app navigation unmounts the editor — `BaseOffice` is keyed by
 * node — so the buffer goes with it, silently.
 *
 * The check was added at one navigation source, the sidebar's node select. Four
 * others leave the editor just as completely: clicking a member (the workspace
 * view renders P2P chat instead), opening a group, opening the file manager
 * (which deletes `nodeId` from the URL), and switching sessions. Twenty minutes
 * of writing, one stray click.
 *
 * This is the check, once, rather than a sixth copy of the same three lines —
 * five copies is how four of them come to differ, and the one that differs is
 * the one nobody tests.
 */

import { hasUnsavedEdits } from './unsaved-edits';
import { DISCARD_EDIT_PROMPT } from './unsaved-edits-prompt';

type Confirm = (request: typeof DISCARD_EDIT_PROMPT) => Promise<boolean>;

/**
 * True when it is safe to navigate away.
 *
 * Returns true immediately when nothing is dirty, so the common case costs
 * nothing and no navigation is gated behind a dialog that would not appear.
 */
export async function mayLeaveEditor(confirm: Confirm): Promise<boolean> {
  if (!hasUnsavedEdits()) return true;
  return confirm(DISCARD_EDIT_PROMPT);
}
