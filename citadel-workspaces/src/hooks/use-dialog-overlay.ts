import { useEffect, useRef } from 'react';

/**
 * Makes a hand-rolled overlay behave like an actual dialog.
 *
 * Every pre-auth screen — Login, Join, ServerConnect, SecuritySettings and both
 * initialisation modals — was a `fixed inset-0` div with a scrim. Visually a
 * modal; to assistive technology, nothing at all. No `role="dialog"`, so a
 * screen reader was never told one opened and focus stayed on whatever launched
 * it. No trap, so Tab walked the landing-page controls buried under the opaque
 * scrim — focus landing on things the user cannot see. No restore, so closing
 * dropped focus to `<body>`.
 *
 * That is the front door of the product, and every Radix surface deeper in the
 * app already does all of this correctly.
 *
 * `onDismiss` is optional on purpose: the initialisation modals decide for
 * themselves whether they may be dismissed, and wiring Escape to a modal that
 * deliberately refuses to close would be a behaviour change, not an
 * accessibility fix.
 */
const FOCUSABLE: string = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * What a dialog element needs on it, or nothing when this overlay has delegated
 * to a nested one. Named because it is the hook's contract with every caller,
 * and an inferred union of an object and `{}` says less than it looks like.
 */
export interface DialogOverlayProps {
  role?: 'dialog';
  'aria-modal'?: boolean;
  'aria-label'?: string;
  tabIndex?: number;
}

export interface DialogOverlay<T extends HTMLElement> {
  ref: React.RefObject<T>;
  dialogProps: DialogOverlayProps;
}

export function useDialogOverlay<T extends HTMLElement = HTMLDivElement>({
  label,
  onDismiss,
  enabled = true,
}: {
  label: string;
  onDismiss?: () => void;
  /**
   * False while this overlay has delegated to a nested one. Login renders
   * SecuritySettings inside its own scrim, and two live traps both listening on
   * the document would answer one Escape twice and fight over focus.
   */
  enabled?: boolean;
}): DialogOverlay<T> {
  const ref: React.RefObject<T> = useRef<T>(null);

  useEffect(() => {
    if (!enabled) return;
    const previouslyFocused: HTMLElement | null = document.activeElement as HTMLElement | null;
    // The first field, not the container: a screen reader announces the dialog
    // from its label and the user lands where they need to type.
    const first: HTMLElement | null | undefined = ref.current?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? ref.current)?.focus();

    return (): void => {
      // Only if it is still in the document — the launcher is often unmounted
      // by the same state change that closes this.
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && onDismiss) {
        // Handled already: a Radix dialog nested in this one closed on this key,
        // and re-enabled this overlay before the event reached it.
        if (!event.defaultPrevented) onDismiss();
        return;
      }
      if (event.key !== 'Tab' || !ref.current) return;

      const items: HTMLElement[] = Array.from(ref.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) return;

      const first: HTMLElement = items[0];
      const last: HTMLElement = items[items.length - 1];
      const active: Element | null = document.activeElement;

      // Wrap at both ends. Without this, Tab from the last field leaves the
      // dialog for controls hidden behind the scrim.
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return (): void => document.removeEventListener('keydown', onKeyDown);
  }, [onDismiss, enabled]);

  return {
    ref,
    dialogProps: enabled ? {
      role: 'dialog' as const,
      'aria-modal': true,
      'aria-label': label,
      tabIndex: -1,
    } : {},
  };
}
