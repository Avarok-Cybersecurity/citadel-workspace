/**
 * Navigating away from an unsaved edit must ask first.
 *
 * `use-unsaved-mdx-guard` armed `beforeunload`, which covers closing the tab and
 * nothing else — its own footer comment referred to "any future navigation
 * guard". So the click that loses the most work, selecting another node in the
 * sidebar, threw the buffer away silently: BaseOffice is keyed by node, so
 * selecting one unmounts the editor.
 *
 * A router-level blocker would cover every path at once, but `useBlocker`
 * requires a data router and this app mounts `<BrowserRouter>`. Until that
 * migration the navigation sources ask, and this is the shared answer they ask.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerUnsavedEdits,
  hasUnsavedEdits,
  clearUnsavedEditsForTests,
} from '../unsaved-edits';

beforeEach(() => {
  clearUnsavedEditsForTests();
});

describe('the shared unsaved-edits answer', () => {
  it('is false when nothing is being edited', () => {
    expect(hasUnsavedEdits()).toBe(false);
  });

  it('is true while an editor holds unsaved work', () => {
    registerUnsavedEdits('node-1');
    expect(hasUnsavedEdits()).toBe(true);
  });

  it('clears when that editor releases', () => {
    const release: () => void = registerUnsavedEdits('node-1');
    release();
    expect(hasUnsavedEdits()).toBe(false);
  });

  it('stays true while ANY editor is still dirty', () => {
    const releaseFirst: () => void = registerUnsavedEdits('node-1');
    registerUnsavedEdits('node-2');

    releaseFirst();

    // Keyed by owner rather than counted, so releasing one editor cannot
    // answer for another — and a double release cannot drive a count negative.
    expect(hasUnsavedEdits()).toBe(true);
  });

  it('is idempotent per owner', () => {
    const release: () => void = registerUnsavedEdits('node-1');
    registerUnsavedEdits('node-1');
    release();
    expect(hasUnsavedEdits()).toBe(false);
  });
});

describe('the sidebar asks before discarding', () => {
  it('consults the shared answer before navigating', async () => {
    // The store above is correct and would stay correct with nothing consulting
    // it — which is the state this fix found. This is the wiring.
    //
    // The three lines this used to look for now live in `mayLeaveEditor`, so
    // that every navigation which unmounts the editor asks the same question:
    // the check had been applied at this one source and four others discarded
    // the buffer silently. `leaving-the-editor-asks-first` covers all five;
    // this keeps the sidebar's own wiring pinned.
    // The sidebar's select is use-select-node now, shared with the header's
    // breadcrumbs, and that goes through the router-bound guard. The chain:
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { stripComments } = await import('@/test-utils/strip-comments');
    const read = (rel: string): string => stripComments(readFileSync(join(process.cwd(), 'src', rel), 'utf8'));
    expect(read('components/layout/sidebar/HierarchySidebar.tsx')).toMatch(/\bhandleNodeSelect: SelectNode = useSelectNode\(\)/);
    expect(read('hooks/use-select-node.ts')).toMatch(/\buseGuardedNavigate\(\)/);
    expect(read('hooks/use-guarded-navigate.ts')).toContain('mayLeaveEditor(confirm)');
  });
});
