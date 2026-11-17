/**
 * The file-manager filter must not travel with the user, and an empty result
 * must not be reported as an empty folder.
 *
 * `filterText` matches only the current directory's immediate children, and it
 * persisted across folder navigation, peer switches and storage-mode switches.
 * When it then matched nothing, the grid rendered:
 *
 *   "This folder is empty"
 *   "Drag files here or right-click to create a folder"
 *
 * about a folder with files in it. The filter box is 32px wide in the top-right
 * corner, so there was nothing on screen to explain where the files went.
 *
 * The sibling selection-clearing effect already lists exactly the right
 * dependencies — currentPath, storageMode, selectedPeerCid — and its comment
 * explains why a stale selection is destructive. The filter was simply never
 * added to the same treatment.
 */
import { describe, it, expect, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { render, screen } from '@testing-library/react';
import { VFSContentGrid } from '../VFSContentGrid';
import { gridProps } from './grid-fixture';
import type { RevfsNode } from "@/types/revfs-types";

function file(name: string): RevfsNode {
  return { name, path: `/docs/${name}`, type: 'file', createdAt: 0, updatedAt: 0 };
}

/** The whole tree; the grid resolves `currentPath` inside it. */
function treeWith(children: RevfsNode[]): RevfsNode {
  return {
    name: '', path: '/', type: 'directory', createdAt: 0, updatedAt: 0,
    children: [{ name: 'docs', path: '/docs', type: 'directory', children, createdAt: 0, updatedAt: 0 }],
  };
}

describe('the file grid with nothing to show', () => {
  it('says the folder is empty only when it IS empty', () => {
    render(<VFSContentGrid {...gridProps(treeWith([]), { currentPath: '/docs' })} />);

    expect(screen.getByText(/this folder is empty/i)).toBeInTheDocument();
  });

  it('says the FILTER matched nothing when a filter is active', () => {
    render(<VFSContentGrid {...gridProps(treeWith([file('invoice.pdf'), file('notes.md')]), { currentPath: '/docs', filterText: 'zzz-no-such-file' })} />);

    // Reporting "empty" here tells the user their files are gone.
    expect(screen.queryByText(/this folder is empty/i)).toBeNull();
    expect(screen.getByText('No matches')).toBeInTheDocument();
    expect(screen.getByText(/zzz-no-such-file/)).toBeInTheDocument();
  });

  it('offers to clear a filter that matched nothing', async () => {
    const onClearFilter: ReturnType<typeof vi.fn> = vi.fn();
    render(<VFSContentGrid {...gridProps(treeWith([file('a.pdf')]), { currentPath: '/docs', filterText: 'zzz', onClearFilter })} />);
    await userEvent.click(screen.getByRole('button', { name: 'Clear filter' }));
    expect(onClearFilter).toHaveBeenCalledTimes(1);
  });

  it('shows only what matches', () => {
    render(<VFSContentGrid {...gridProps(treeWith([file('invoice.pdf'), file('notes.md')]), { currentPath: '/docs', filterText: 'INVO' })} />);
    expect(screen.getByTestId('vfs-item-invoice.pdf')).toBeInTheDocument();
    expect(screen.queryByTestId('vfs-item-notes.md')).toBeNull();
  });
});
