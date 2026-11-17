/**
 * How the sidebar shows which row you are on.
 *
 * The whole sidebar -- tree nodes, peer conversations, group conversations --
 * marked the current row with `bg-primary-accent/20` and nothing else.
 * Composited over the sidebar's own background that tint measures **1.37:1**,
 * where WCAG 1.4.11 asks for 3:1 of any state a control uses to convey
 * information. The state was really being carried by the text colour changing,
 * which is 2.86:1 against the idle text -- a difference, but a difference made
 * of colour alone.
 *
 * A left rule carried it next (6.38:1), but a 2px rule on a rounded row read
 * as a curved sliver stuck to one edge. It is now a macOS-style selection
 * pill: the tint, a hairline inset outline in the accent at 70%, and a faint
 * top highlight. The outline is the 3:1 cue -- a shape around the whole row,
 * computed at 4.19:1 (dark) / 4.34:1 (light) against the sidebar and above 3:1
 * against the tint itself, with the same model that reproduces the measured
 * 6.38:1 for the full-strength rule.
 *
 * It is a box-shadow, not a border or a `ring-*`: a shadow takes no layout, so
 * idle rows reserve nothing, and SidebarMenuButton already sets
 * `ring-sidebar-ring` for focus, which a `ring-primary-accent` here would have
 * fought by stylesheet order -- the trap described below.
 *
 * One function, in one place, because three components render this state and a
 * fourth will; three copies of it is how the tree came to say one thing and the
 * conversation list another.
 *
 * A function rather than two class strings to concatenate. The first attempt
 * put `border-transparent` in a base string and `border-primary-accent` in the
 * selected one, which lands both in the same `class` attribute -- and which
 * wins is then decided by their order in the stylesheet, not by the order they
 * were written. Measured: the rule came out at 1:1 against the sidebar, exactly
 * as invisible as the tint it was meant to replace. Two mutually exclusive
 * classes need no override and cannot be reordered into each other.
 */

/** The selection pill's outline and highlight; see above for the contrast. */
export const SELECTED_OUTLINE: string = 'shadow-[inset_0_0_0_1px_hsl(var(--primary-accent)/0.7),inset_0_1px_0_hsl(0_0%_100%/0.06)]';

/** The classes for a sidebar row, given whether it is the one on screen. */
export function rowClass(isSelected: boolean): string {
  return [
    'transition-colors',
    'hover:bg-primary-accent/15 hover:text-foreground',
    isSelected
      ? `${SELECTED_OUTLINE} bg-primary-accent/20 text-primary-accent`
      : 'text-foreground',
  ].join(' ');
}
