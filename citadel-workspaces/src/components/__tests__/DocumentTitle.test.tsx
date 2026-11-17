/**
 * Every route rendered the same tab title, because index.html set one and
 * nothing changed it. axe cannot see that — a title IS present, and a scan only
 * ever sees one route at a time.
 */
import { describe, it, expect } from 'vitest';
import { render , type RenderResult } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DocumentTitle, titleForPath } from '../DocumentTitle';

function renderAt(path: string): RenderResult {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <DocumentTitle />
    </MemoryRouter>,
  );
}

describe('titleForPath', () => {
  it('names each route distinctly', () => {
    const paths: string[] = ['/', '/connect', '/workspace', '/messages', '/directory', '/groups/abc'];
    const titles: string[] = paths.map(titleForPath);
    // The whole point: no two routes may share a title, or the tab, the history
    // entry and the screen reader all say the same thing everywhere.
    expect(new Set(titles).size).toBe(paths.length);
  });

  it('names each legal document, so its tab and history entry say which one', () => {
    const titles: string[] = ['terms', 'customer-terms', 'privacy', 'dpa', 'subprocessors'].map((id: string): string => titleForPath(`/legal/${id}`));
    expect(new Set(titles).size).toBe(titles.length);
    expect(titleForPath('/legal/dpa')).toMatch(/^Data Processing Addendum · /);
    expect(titleForPath('/legal/unknown')).toMatch(/^Legal · /);
  });

  it('keeps the landing page as the product title', () => {
    expect(titleForPath('/')).toMatch(/Post-Quantum Secure Collaboration/);
  });

  it('falls back to a not-found title for unknown paths', () => {
    expect(titleForPath('/nope')).toMatch(/Page not found/);
  });

  it('matches a route and its subpaths, not merely a prefix', () => {
    expect(titleForPath('/messages')).toMatch(/^Messages/);
    expect(titleForPath('/messages/xyz')).toMatch(/^Messages/);
    // `/messages-archive` is a DIFFERENT route, not a subpath of /messages.
    expect(titleForPath('/messages-archive')).toMatch(/Page not found/);
  });

  it('ends every non-landing title with the product name', () => {
    for (const p of ['/connect', '/workspace', '/messages', '/directory', '/groups/x', '/nope']) {
      expect(titleForPath(p)).toMatch(/· Citadel Workspaces$/);
    }
  });
});

describe('DocumentTitle', () => {
  it('sets the title on mount', () => {
    renderAt('/directory');
    expect(document.title).toBe(titleForPath('/directory'));
  });

  it('updates when the route changes', () => {
    const { unmount } = renderAt('/messages');
    expect(document.title).toMatch(/^Messages/);
    unmount();
    renderAt('/workspace');
    expect(document.title).toMatch(/^Workspace/);
  });

  it('renders nothing of its own', () => {
    const { container } = renderAt('/');
    expect(container).toBeEmptyDOMElement();
  });
});
