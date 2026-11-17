/**
 * An item the peer has not confirmed says so, and names who is being waited on.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RevfsFileState, type RevfsNode } from '@/types/revfs-types';
import { VFSContentGrid } from '../VFSContentGrid';
import { gridProps } from './grid-fixture';

const file: RevfsNode = {
  name: 'a.bin', path: '/a.bin', type: 'file', fileState: RevfsFileState.Remote, createdAt: 0, updatedAt: 0,
  fileMetadata: { fileId: 'f', fileName: 'a.bin', fileSize: 1, fileType: '', virtualDirectory: '/a.bin', uploadedByCid: 1n },
};
const tree: RevfsNode = { name: '', path: '/', type: 'directory', children: [file], createdAt: 0, updatedAt: 0 };
function grid(pending: ReadonlySet<string>): void {
  render(<VFSContentGrid {...gridProps(tree, { pendingPaths: pending, peerLabel: 'Bob Brown' })} />);
}

describe('a pending item', () => {
  it('is marked, naming the peer', () => {
    grid(new Set(['/a.bin']));
    expect(screen.getByTestId('vfs-pending')).toHaveTextContent('Pending confirmation');
    expect(screen.getByTestId('vfs-pending').getAttribute('title')).toMatch(/^Bob Brown has not confirmed/);
  });

  it('is not marked once confirmed', () => {
    grid(new Set());
    expect(screen.queryByTestId('vfs-pending')).toBeNull();
  });
});
