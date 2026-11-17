import type { KeyboardEvent } from 'react';

/**
 * Keyboard activation for elements that are clickable but are not buttons.
 *
 * A `<div onClick={...}>` is invisible to anyone not using a mouse: it takes no
 * focus, and Enter/Space do nothing on it. The fix is three things together —
 * `role="button"`, `tabIndex={0}`, and a key handler — and doing that by hand at
 * every call site is how one of them ends up missing.
 *
 * Prefer an actual `<button>`. Use this only where the element has NO focusable
 * descendants — copyable text, a drop zone whose layout a button would break.
 *
 * Do NOT reach for it to make a row clickable when that row contains its own
 * buttons. That was the original advice here and it was wrong: role="button"
 * with tabIndex on a container that holds other controls is the
 * nested-interactive pattern, which screen readers do not present consistently —
 * the container claims to be one button while containing more. Split the row
 * instead, so the identity part is a button and the actions are its siblings
 * (see MemberListItem).
 *
 * Spread `interactive(onActivate)` onto the element:
 *
 *   <div {...interactive(() => select(file))} className="...">
 *
 * Space is preventDefault-ed because its default action on a focused element is
 * to scroll the page, which would fire the handler and jump the view at once.
 */
export function activateOnKey<E extends KeyboardEvent>(onActivate: (event: E) => void) {
  return (event: E): void => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    // Ignore keys that bubbled from a control inside this element — a nested
    // input or button handles its own Enter/Space.
    if (event.target !== event.currentTarget) return;
    event.preventDefault();
    // Forwarded, because most handlers here are shared with onClick and take the
    // event (to stopPropagation on a nested row, or read a modifier key).
    onActivate(event);
  };
}

/**
 * The full set of props that make a non-button element behave like one for
 * keyboard and assistive-technology users.
 */
export function interactive(onActivate: () => void): { role: "button"; tabIndex: number; onClick: () => void; onKeyDown: (event: KeyboardEvent<Element>) => void; } {
  return {
    role: 'button' as const,
    tabIndex: 0,
    onClick: onActivate,
    onKeyDown: activateOnKey(() => onActivate()),
  };
}
