/**
 * Handing focus to the composer when a message menu closes on Edit or Reply.
 *
 * A menu returns focus to its own button as it closes, which is right for most items and
 * wrong for these two: the next keystroke belongs in the composer (measured live -- after
 * Edit, typing went nowhere). A focus call made from outside the menu loses to that return,
 * so the menu hands focus over itself: the item marks the choice, and onCloseAutoFocus
 * suppresses the return and focuses the composer. One implementation for every message
 * menu -- group items and P2P bubbles alike.
 */
import { useRef, type MutableRefObject } from 'react';

export interface MenuFocusHandoff {
  /** Wrap an item's action so choosing it sends focus to the composer. */
  toComposer: (action: () => void) => () => void;
  /** For DropdownMenuContent. */
  onCloseAutoFocus: (event: Event) => void;
}

export function useMenuFocusHandoff(focusComposer: (() => void) | undefined): MenuFocusHandoff {
  const pending: MutableRefObject<boolean> = useRef<boolean>(false);
  return {
    toComposer: (action: () => void): (() => void) => (): void => {
      pending.current = focusComposer !== undefined;
      action();
    },
    onCloseAutoFocus: (event: Event): void => {
      if (!pending.current || !focusComposer) return;
      pending.current = false;
      event.preventDefault();
      focusComposer();
    },
  };
}
