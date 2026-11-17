/**
 * The sidebar's "you are here" has to be visible, and it has to be one thing.
 *
 * Every row in the sidebar -- tree nodes, peer conversations, group
 * conversations -- marked the current one with `bg-primary-accent/20` and
 * nothing else. Composited over the sidebar's own background, measured in a
 * browser:
 *
 *   selection tint against the sidebar   1.37 : 1
 *   active text against idle text        2.86 : 1
 *
 * WCAG 1.4.11 asks 3:1 of any state a control uses to convey information. The
 * state was really being carried by the text colour alone. A left rule fixed
 * that (6.38:1 measured) and was then replaced by an inset outline at 70%
 * accent (4.19:1 dark, 4.34:1 light, computed; see selected-row.ts):
 *
 * Those numbers come from `getComputedStyle` in a real browser over the built
 * stylesheet, because a tint's contrast cannot be computed from the class name
 * and jsdom composites nothing. What THIS file pins is the property that broke
 * the first attempt, which is testable here: the two states must not both set
 * the same property and leave the stylesheet's order to decide.
 */
import { describe, it, expect } from 'vitest';
import { rowClass, SELECTED_OUTLINE } from '../selected-row';

const classesOf = (isSelected: boolean): string[] => rowClass(isSelected).split(/\s+/);

describe('rowClass', () => {
  it('outlines the selected row in the accent colour', () => {
    expect(classesOf(true)).toContain(SELECTED_OUTLINE);
    expect(SELECTED_OUTLINE).toMatch(/inset_0_0_0_1px_hsl\(var\(--primary-accent\)\/0\.7\)/);
  });

  it('draws no edge rule, which read as a sliver on a rounded row', () => {
    for (const selected of [true, false]) {
      expect(classesOf(selected).filter((c) => c.startsWith('border-l'))).toEqual([]);
    }
  });

  it('leaves idle rows unoutlined, and never fights the focus ring', () => {
    // SidebarMenuButton sets ring-sidebar-ring for focus; a ring-* colour here
    // would be decided by stylesheet order against it.
    expect(classesOf(false).some((c) => c.startsWith('shadow-'))).toBe(false);
    for (const selected of [true, false]) {
      expect(classesOf(selected).some((c) => c.startsWith('ring-'))).toBe(false);
    }
  });

  it('does not put the accent text colour on an idle row', () => {
    expect(classesOf(false)).toContain('text-foreground');
    expect(classesOf(false)).not.toContain('text-primary-accent');
  });
});
