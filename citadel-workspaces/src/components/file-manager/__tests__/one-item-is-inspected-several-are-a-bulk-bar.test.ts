/**
 * What the side of the file manager shows for a selection: nothing, the
 * inspector for one item, or the bulk bar for several. Derived from the
 * selection and the tree, so an item that disappears takes its panel with it.
 */
import { describe, it, expect } from 'vitest';
import type { RevfsNode } from '@/types/revfs-types';
import { selectionPanel } from '../selection-panel';

const a: RevfsNode = { name: 'a.pdf', path: '/a.pdf', type: 'file', createdAt: 1, updatedAt: 1 };
const b: RevfsNode = { name: 'b.pdf', path: '/b.pdf', type: 'file', createdAt: 1, updatedAt: 1 };
const tree: RevfsNode = { name: '', path: '/', type: 'directory', children: [a, b], createdAt: 1, updatedAt: 1 };

describe('the selection panel', () => {
  it('is nothing with nothing selected', () => {
    expect(selectionPanel(tree, new Set())).toEqual({ kind: 'none' });
  });

  it('inspects the one item selected', () => {
    expect(selectionPanel(tree, new Set(['/a.pdf']))).toEqual({ kind: 'inspector', node: a });
  });

  it('becomes the bulk bar for two or more', () => {
    expect(selectionPanel(tree, new Set(['/a.pdf', '/b.pdf']))).toEqual({ kind: 'bulk', nodes: [a, b] });
  });

  it('counts only what is still in the tree', () => {
    // Deleted elsewhere while selected: a bulk bar for "2 selected" with one of
    // them gone would act on a path that names nothing.
    expect(selectionPanel(tree, new Set(['/a.pdf', '/gone.pdf']))).toEqual({ kind: 'inspector', node: a });
    expect(selectionPanel(tree, new Set(['/gone.pdf']))).toEqual({ kind: 'none' });
  });

  it('is nothing without a tree', () => {
    expect(selectionPanel(null, new Set(['/a.pdf']))).toEqual({ kind: 'none' });
  });
});
