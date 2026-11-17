/**
 * The content grid's props for a test: real defaults for what a test does not
 * look at, with every action a spy so a test can say which one a gesture reached.
 * The spies stand in for the file manager's handlers, which talk to RE-VFS; what
 * is under test is the grid deciding which action a click, key or menu means.
 */
import { vi } from 'vitest';
import type { RevfsNode } from '@/types/revfs-types';
import type { VFSItemActions } from '../vfs-item-actions';
import type { VFSContentGridProps } from '../VFSContentGrid';

export type SpiedActions = { [K in keyof VFSItemActions]: VFSItemActions[K] & ReturnType<typeof vi.fn> };

export function spyActions(): SpiedActions {
  return {
    openFolder: vi.fn(), openFile: vi.fn(), openInDocs: vi.fn(), inspect: vi.fn(), download: vi.fn(), share: vi.fn(), moveTo: vi.fn(),
    copyLink: vi.fn(), remove: vi.fn(), rename: vi.fn(async (): Promise<void> => {}), cut: vi.fn(), copy: vi.fn(),
    paste: vi.fn(async (): Promise<void> => {}), newFolder: vi.fn(), upload: vi.fn(), refresh: vi.fn(), drop: vi.fn(),
  } as SpiedActions;
}

export function gridProps(tree: RevfsNode, over: Partial<VFSContentGridProps>): VFSContentGridProps {
  return {
    tree, currentPath: '/', view: 'list', actions: spyActions(), isP2P: false, storageName: 'Server Storage',
    pendingPaths: new Set<string>(), peerLabel: 'Bob', cutItemPaths: new Set<string>(), hasPasteItems: false,
    selectedPaths: new Set<string>(), onSelect: vi.fn(), onSelectAll: vi.fn(), onClearSelection: vi.fn(),
    sortField: 'name', sortDirection: 'asc', filterText: '', onClearFilter: vi.fn(), upload: { kind: 'offered' },
    nameOf: (cid: bigint): string => `peer ${cid.toString()}`, now: 0,
    ...over,
  };
}
