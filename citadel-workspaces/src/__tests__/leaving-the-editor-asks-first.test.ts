/**
 * Every way out of the editor asks before discarding the buffer.
 *
 * `beforeunload` covers closing the tab and nothing else. In-app navigation
 * unmounts the editor — `BaseOffice` is keyed by node — so the buffer goes with
 * it, silently. The check was added at one navigation source, the sidebar's
 * node select, and four others leave just as completely: clicking a member (the
 * workspace view renders P2P chat instead), opening a group, opening the file
 * manager (which deletes `nodeId` from the URL), and switching sessions.
 *
 * Twenty minutes of writing, one stray click.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from '@/test-utils/strip-comments';

const SRC: string = join(process.cwd(), 'src');

/**
 * Navigation sources that unmount the document editor.
 *
 * Listed rather than derived: "does this navigation unmount BaseOffice" is not
 * a textual property, and a scan that guessed would either miss one or flag
 * every navigate() in the app.
 */
const LEAVES_THE_EDITOR: string[] = [
  // The sidebar's node select is use-select-node.ts now, shared with the breadcrumbs: see SELECT_A_NODE.
  // MembersSection no longer navigates itself: its contact and member rows open
  // chats through use-open-conversation.ts, listed below with the guarded ones.
  'components/layout/sidebar/FilesSection.tsx',
  'components/layout/sidebar/useWorkspaceSwitcher.tsx',
  // Exit to Landing and Sign Out: both do work before they navigate, so they
  // ask with the check itself rather than through useGuardedNavigate.
  'components/layout/sidebar/use-session-exit.ts',
];

/**
 * Controls on screen beside the editor whose only way to navigate is
 * useGuardedNavigate. A raw `useNavigate()` here is how the Messages icon, the
 * office title, the group rows, the call bar and a notification's "open
 * conversation" each came to discard the buffer while the sidebar next to them
 * asked. Files that still hold a raw navigate behind an explicit
 * mayLeaveEditor call are in LEAVES_THE_EDITOR instead.
 */
const NAVIGATES_ONLY_THROUGH_THE_GUARD: string[] = [
  'components/office/OfficeLayout.tsx',
  'components/notification/NotificationCenter.tsx',
  'components/layout/sidebar/GroupConversationRow.tsx',
  'components/layout/sidebar/MembersSectionModals.tsx',
  'components/call/OngoingCallBar.tsx',
  'components/layout/sidebar/use-open-conversation.ts',
  'hooks/use-select-node.ts',
];

/** Open a node in the tree, and so must do it the one guarded way (use-select-node.ts). */
const SELECT_A_NODE: string[] = [
  'components/layout/sidebar/HierarchySidebar.tsx',
  'components/office/OfficeBreadcrumbs.tsx',
];

describe('a navigation that unmounts the editor', () => {
  it('asks before discarding unsaved work', () => {
    const offenders: string[] = LEAVES_THE_EDITOR.filter(
      (rel) => !/mayLeaveEditor\s*\(/.test(stripComments(readFileSync(join(SRC, rel), 'utf-8'))),
    );

    expect(
      offenders,
      'this navigation unmounts the document editor without asking, so the ' +
        'buffer is discarded silently. Call mayLeaveEditor(confirm) first.',
    ).toEqual([]);
  });

  it('cannot reach a raw navigate from a control beside the editor', () => {
    const offenders: string[] = NAVIGATES_ONLY_THROUGH_THE_GUARD.filter((rel) => {
      const source: string = stripComments(readFileSync(join(SRC, rel), 'utf-8'));
      return /\buseNavigate\s*\(/.test(source) || !/\buseGuardedNavigate\s*\(/.test(source);
    });

    expect(
      offenders,
      'these controls sit beside the document editor and navigate without ' +
        'asking, so an unsaved edit is discarded silently. Use ' +
        'useGuardedNavigate() from @/hooks/use-guarded-navigate.',
    ).toEqual([]);
  });

  it('opens a node only through the shared select, from the sidebar and the breadcrumbs alike', () => {
    const offenders: string[] = SELECT_A_NODE.filter(
      (rel) => !/\buseSelectNode\s*\(/.test(stripComments(readFileSync(join(SRC, rel), 'utf-8'))),
    );
    expect(offenders, 'open nodes with useSelectNode() from @/hooks/use-select-node, which asks first').toEqual([]);
  });

  it('asks only when something is actually dirty', async () => {
    // A prompt on every navigation would be trained away within a day, and the
    // one that matters would go with it.
    const { mayLeaveEditor } = await import('@/lib/leave-editor');
    const { registerUnsavedEdits, clearUnsavedEditsForTests } = await import('@/lib/unsaved-edits');

    clearUnsavedEditsForTests();

    let asked: number = 0;
    const confirm = async (): Promise<boolean> => {
      asked += 1;
      return true;
    };

    expect(await mayLeaveEditor(confirm)).toBe(true);
    expect(asked, 'a clean editor must not prompt').toBe(0);

    const clear: () => void = registerUnsavedEdits('doc-1');
    expect(await mayLeaveEditor(confirm)).toBe(true);
    expect(asked, 'a dirty editor must prompt').toBe(1);

    clear();
    expect(await mayLeaveEditor(confirm)).toBe(true);
    expect(asked, 'clearing must stop the prompting').toBe(1);
  });

  it('blocks the navigation when the user says no', async () => {
    const { mayLeaveEditor } = await import('@/lib/leave-editor');
    const { registerUnsavedEdits, clearUnsavedEditsForTests } = await import('@/lib/unsaved-edits');

    clearUnsavedEditsForTests();
    registerUnsavedEdits('doc-2');

    expect(await mayLeaveEditor(async () => false)).toBe(false);
  });
});
