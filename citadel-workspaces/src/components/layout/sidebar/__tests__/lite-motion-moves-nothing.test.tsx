/**
 * The focused tree's lite tier projects nothing: no layoutId, no layout, no measured height --
 * only opacity. Full keeps every glide. The tier is the document's (use-motion-tier), set here
 * through the real Appearance setting.
 *
 * Real: TreeMotion, its row hooks and AutoHeight, the setting and the document classes.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { applyAppearanceSettings, defaultAppearanceSettings, type AppearanceSettings } from '@/lib/appearance-settings';
import { TreeMotion, useRowItem, useRowLine } from '../FocusedTree/tree-motion';
import { AutoHeight } from '../FocusedTree/tree-boxes';

function Probe(): JSX.Element {
  return <output data-testid="row">{JSON.stringify({ line: useRowLine('eng'), item: useRowItem() })}</output>;
}

function show(animations: AppearanceSettings['animations']): { line: Record<string, unknown>; item: Record<string, unknown>; measured: boolean } {
  applyAppearanceSettings({ ...defaultAppearanceSettings, animations });
  const { container } = render(<TreeMotion><AutoHeight><Probe /></AutoHeight></TreeMotion>);
  const parsed: { line: Record<string, unknown>; item: Record<string, unknown> } = JSON.parse(screen.getByTestId('row').textContent ?? '{}');
  return { ...parsed, measured: container.querySelector('.overflow-hidden') !== null };
}

afterEach(() => { cleanup(); applyAppearanceSettings({ ...defaultAppearanceSettings, animations: 'full' }); });

describe('the focused tree', () => {
  it('at lite: rows carry no layout id and no layout, the box no measured height, and lines fade in', () => {
    const { line, item, measured } = show('lite');
    expect(line.layoutId).toBeUndefined();
    expect(line.layout).toBeUndefined();
    expect(item).toEqual({});
    expect(measured).toBe(false);
    expect(line.initial).toEqual({ opacity: 0 });
  });

  it('at full: every glide is kept', () => {
    // The discrimination for the case above.
    const { line, item, measured } = show('full');
    expect(line.layoutId).toBe('eng');
    expect(line.layout).toBe('position');
    expect(item).toEqual({ layout: 'position' });
    expect(measured).toBe(true);
  });
});
