import { preferredScrollBehavior } from '@/lib/motion';
import { debugLog } from '@/lib/debug-config';

/** The attribute every rendered message carries, so a quote can find it. */
export const MESSAGE_ANCHOR_ATTRIBUTE: 'data-message-id' = 'data-message-id';

/** Set on the original for a moment after a jump; styled in the component. */
export const JUMP_HIGHLIGHT_ATTRIBUTE: 'data-reply-highlight' = 'data-reply-highlight';

/** Classes for an anchor element, so the highlight is visible in either theme. */
export const JUMP_TARGET_CLASSES: string =
  'rounded-lg outline-none transition-shadow data-[reply-highlight=true]:ring-2 data-[reply-highlight=true]:ring-ring';

const HIGHLIGHT_MS: number = 1600;

/**
 * Scrolls to a loaded message, highlights it briefly and moves focus to it, so
 * a keyboard user lands where a sighted one looks.
 *
 * Found by comparing attributes rather than building a selector: ids arrive
 * from peers, and a crafted id must not be able to become selector syntax.
 *
 * Nothing to return: a quote is only a button when its original is in the
 * loaded list, which is the list on screen, so a miss means the list changed
 * under the click. It is logged, and there is nowhere to scroll to.
 */
export function jumpToMessage(messageId: string, root: ParentNode): void {
  const target: HTMLElement | undefined = Array.from(
    root.querySelectorAll<HTMLElement>(`[${MESSAGE_ANCHOR_ATTRIBUTE}]`),
  ).find((element: HTMLElement): boolean => element.getAttribute(MESSAGE_ANCHOR_ATTRIBUTE) === messageId);
  if (!target) {
    debugLog('jumpToMessage', 'original not rendered:', messageId);
    return;
  }
  target.scrollIntoView({ behavior: preferredScrollBehavior(), block: 'center' });
  if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
  target.focus({ preventScroll: true });
  target.setAttribute(JUMP_HIGHLIGHT_ATTRIBUTE, 'true');
  window.setTimeout((): void => { target.removeAttribute(JUMP_HIGHLIGHT_ATTRIBUTE); }, HIGHLIGHT_MS);
}
