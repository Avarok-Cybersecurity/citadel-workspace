/**
 * Toasts.
 *
 * The app previously mounted TWO toast systems at once — shadcn's `<Toaster />`
 * (backed by a hand-rolled reducer in this file) and `<Sonner />` — so which
 * visual style a notification got depended on which feature raised it: 33 files
 * used `useToast()`, while the file manager imported `toast` from `sonner`
 * directly. Same product, two different-looking notifications.
 *
 * This module now keeps the `useToast()` / `toast({ title, description })` call
 * shape those 33 files already use, but renders through Sonner. One system, no
 * call-site churn, and the shadcn toast/toaster components are gone.
 */

import type React from 'react';
import { createElement } from 'react';
import { toast as sonnerToast } from 'sonner';

/**
 * `destructive` is the shadcn name the existing call sites pass; it is kept so
 * they need no edit. `outline` was used once and has no error semantics, so it
 * renders neutral.
 */
export type ToastVariant = 'default' | 'success' | 'destructive' | 'outline';

export interface ToastOptions {
  title?: React.ReactNode;
  description?: React.ReactNode;
  variant?: ToastVariant;
  /** Milliseconds before auto-dismiss. Omit for Sonner's default. */
  duration?: number;
  action?: { label: string; onClick: () => void };
  /**
   * Stable identity for a toast that can be raised more than once for the same
   * underlying fact. Sonner replaces an existing toast with the same id instead
   * of stacking a second one, which is what a re-offer wants: the update prompt
   * accumulated an identical infinite-duration toast every time the user
   * returned to the tab.
   */
  id?: string | number;
}

export interface ToastHandle {
  id: string | number;
  dismiss: () => void;
}

/**
 * Sonner's first argument is the headline. Call sites overwhelmingly pass
 * `title` + `description`, but a few pass only one of them — falling back keeps
 * a toast with just a description from rendering as an empty bubble.
 */
function headline(options: ToastOptions): React.ReactNode {
  return options.title ?? options.description ?? '';
}

function body(options: ToastOptions): React.ReactNode | undefined {
  return options.title ? options.description : undefined;
}

/**
 * An error toast announces itself, and can be found by the selector everyone
 * reaches for.
 *
 * The DESCRIPTION carries the alert, not the headline. Wrapping the headline
 * was the first attempt and it cost the description entirely -- Sonner renders
 * no description when its message is a ReactNode, so the toast shrank to
 * "Connection Error" and dropped the sentence telling the user what to do. The
 * agent-down gate caught it on the next run.
 *
 * Sonner renders its toasts inside a single `aria-live="polite"` region, so an
 * error waited for the user to pause before being read -- and an error that
 * blocks the action they just took is the case for `assertive`. The app already
 * uses `role="alert"` for the equivalent inline errors.
 *
 * It also closes a trap this repository has fallen into twice, and had already
 * written down: a Sonner toast carries no `role="alert"`, so an assertion
 * looking for one reports "the app said nothing" about an app that said exactly
 * the right thing. Documenting that did not stop it happening again. Making the
 * selector true does.
 *
 * Only for errors. Success and neutral toasts are ambient and interrupting a
 * screen-reader user with them is the opposite of helpful.
 */
function announce(description: React.ReactNode, variant: ToastVariant): React.ReactNode {
  if (variant !== 'destructive' || description === undefined) return description;
  return createElement('span', { role: 'alert' }, description);
}

export function toast(options: ToastOptions): ToastHandle {
  const payload: { description: React.ReactNode; duration: number | undefined; action: { label: string; onClick: () => void; } | undefined; id: string | number | undefined; } = {
    description: announce(body(options), options.variant ?? 'default'),
    duration: options.duration,
    action: options.action,
    id: options.id,
  };

  const message: React.ReactNode = headline(options);

  const id: string | number =
    options.variant === 'destructive'
      ? sonnerToast.error(message, payload)
      : options.variant === 'success'
        ? sonnerToast.success(message, payload)
        : sonnerToast(message, payload);

  return { id, dismiss: () => sonnerToast.dismiss(id) };
}

/**
 * Kept as a hook so the 33 existing `const { toast } = useToast()` call sites are
 * unchanged. There is no per-component state any more — `toast` is a stable
 * module-level function — so this deliberately returns the same object shape
 * rather than something memoised per render.
 */
export function useToast(): {
  toast: typeof toast;
  dismiss: (id?: string | number) => void;
} {
  return { toast, dismiss: sonnerToast.dismiss };
}
