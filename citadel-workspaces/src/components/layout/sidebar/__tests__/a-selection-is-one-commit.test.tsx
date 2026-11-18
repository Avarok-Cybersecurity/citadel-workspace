/**
 * A selection commits the focused tree ONCE: peeks and the expanded stack reset in that same commit.
 *
 * Every row glides by FLIP from the commit that moves it. The reset used to run in an effect, after
 * paint, so every selection rendered the tree a second time a frame later and framer re-measured every
 * layout row in the glide's second frame -- on a slow CPU a frame long enough to carry the glide nearly
 * to its end: rows and boxes jumped 16-70px in one frame (UI sweep, aLevelChangeIsOneMotion, on CI).
 *
 * Spied, not mocked: FocusedTree is wrapped to count its commits and otherwise runs unchanged. Nothing
 * else is replaced; this is the real TreeNodesSection, as the polish harness renders it.
 */
import { describe, it, expect, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { SidebarProvider } from '@/components/ui/sidebar';
import { TooltipProvider } from '@/components/ui/tooltip';
import { TreeNodesSection } from '../TreeNodesSection';
import { ESTATE } from './render-hierarchy';

const commits: { count: number } = vi.hoisted(() => ({ count: 0 }));

vi.mock('../FocusedTree/FocusedTree', async (load: () => Promise<typeof import('../FocusedTree/FocusedTree')>) => {
  const real: typeof import('../FocusedTree/FocusedTree') = await load();
  const React: typeof import('react') = await import('react');
  return {
    ...real,
    // Called as a function, its hooks are this wrapper's: the wrapper commits exactly when the tree does.
    FocusedTree: (props: Parameters<typeof real.FocusedTree>[0]): JSX.Element => {
      const { useLayoutEffect } = React;
      useLayoutEffect((): void => { commits.count += 1; });
      return real.FocusedTree(props);
    },
  };
});

const NOTHING = (): void => {};

function renderTree(selected: string): { select: (id: string) => void } {
  const tree = (id: string): ReactNode => (
    <SidebarProvider>
      <TooltipProvider delayDuration={0}>
        <TreeNodesSection workspaceName="Lexelnet" nodes={ESTATE} selectedNodeId={id} onNodeSelect={NOTHING} />
      </TooltipProvider>
    </SidebarProvider>
  );
  const { rerender } = render(tree(selected));
  return { select: (id: string): void => { act((): void => { rerender(tree(id)); }); } };
}

describe('a selection in the focused tree', () => {
  it('commits the tree once', () => {
    const { select } = renderTree('floor3');
    commits.count = 0;
    select('berlin');
    expect(screen.getByTestId('tree-node-berlin')).toHaveAttribute('aria-selected', 'true');
    expect(commits.count).toBe(1);
  });

  it('closes an open peek in that same commit', async () => {
    const { select } = renderTree('alex');
    await act(async (): Promise<void> => { screen.getByTestId('tree-node-toggle-potsdamer').click(); });
    expect(screen.getByTestId('tree-node-pfloor1')).toBeInTheDocument();
    commits.count = 0;
    select('floor3');
    expect(screen.queryByTestId('tree-node-pfloor1')).toBeNull();
    expect(commits.count).toBe(1);
  });
});
