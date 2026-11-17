/**
 * The workspace home describes this workspace, not the editor.
 *
 * Measured live: every tenant's home page was the "MDX Editor Showcase" -- a
 * tutorial on Markdown syntax, titled "Welcome to Your Workspace" -- with its
 * Edit button disabled because nothing stores it. It said nothing about the
 * workspace a person had just joined.
 */
import { describe, it, expect } from 'vitest';
import { getWorkspaceHomeContent } from '../workspace-home-content';

describe('the workspace home', () => {
  it('names the workspace and lists its top-level spaces', () => {
    const page: string = getWorkspaceHomeContent('Harbor', 'Ships and shipping', [
      { name: 'Engineering', description: 'Builds things' },
      { name: 'Sales', description: '' },
    ]);
    expect(page).toMatch(/^# Harbor$/m);
    expect(page).toContain('Ships and shipping');
    expect(page).toMatch(/\*\*Engineering\*\* — Builds things/);
    expect(page).toMatch(/\*\*Sales\*\*$/m);
    expect(page).not.toMatch(/Showcase|\*\*text\*\*/);
  });

  it('says what to do when there is nothing in it yet', () => {
    expect(getWorkspaceHomeContent('Harbor', '', [])).toMatch(/no offices yet/i);
  });

  it('escapes names, which MDX would otherwise run as code', () => {
    const page: string = getWorkspaceHomeContent('R&D {beta}', '', [{ name: '<Lab>', description: '{x}' }]);
    expect(page).toContain('# R&D \\{beta\\}');
    expect(page).toContain('**\\<Lab\\>** — \\{x\\}');
    expect(page).not.toMatch(/(^|[^\\])[{<]/);
  });
});
